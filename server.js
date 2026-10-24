
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const {
    chargerMatchsHistoriques,
    chargerCalendrierOpenFootball
} = require("./adaptateur_openfootball");
const { calculerProbabilites, normaliserNomEquipe } = require("./moteur_dazypredict");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// ========================================
// VÉRIFICATION DE LA CLÉ API
// ========================================

const apiFootballDisponible = Boolean(process.env.API_FOOTBALL_KEY);

if (apiFootballDisponible) {
    console.log("✅ Clé API-Football détectée");
} else {
    console.warn("⚠️ API-Football indisponible; les routes locales restent actives.");
}

function verifierApiFootball(req, res, next) {
    if (!apiFootballDisponible) {
        return res.status(503).json({
            success: false,
            message: "API-Football indisponible : aucune clé API n'est configurée."
        });
    }

    return next();
}

// ========================================
// CONNEXION API-FOOTBALL
// ========================================

const apiFootball = axios.create({
    baseURL: "https://v3.football.api-sports.io",
    headers: apiFootballDisponible
        ? { "x-apisports-key": process.env.API_FOOTBALL_KEY }
        : {},
    timeout: 15000
});

// ========================================
// ACCUEIL
// ========================================

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "DazyPredict Backend fonctionne !",
        status: "online"
    });
});

// ========================================
// TEST API-FOOTBALL
// ========================================

app.get("/api/test", verifierApiFootball, async (req, res) => {
    try {
        const response = await apiFootball.get("/status");

        res.json({
            success: true,
            message: "Connexion API-Football réussie",
            api: {
                status: response.data?.response?.account
                    ? "connectée"
                    : "connectée"
            }
        });

    } catch (error) {
        console.error(
            "❌ Erreur API-Football :",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            message: "Connexion à API-Football impossible",
            erreur: error.response?.data || error.message
        });
    }
});

// ========================================
// MATCHS DU JOUR
// ========================================



const CACHE_CALENDRIER_24H = 24 * 60 * 60 * 1000;
const CACHE_RESECOURS_1H = 60 * 60 * 1000;
let cacheCalendrier = null;
let actualisationCalendrierEnCours = null;

function obtenirSaisonOpenFootball(date = new Date()) {
    const anneeDebut = date.getUTCMonth() >= 6
        ? date.getUTCFullYear()
        : date.getUTCFullYear() - 1;
    return `${anneeDebut}-${String(anneeDebut + 1).slice(-2)}`;
}

function normaliserEquipeCalendrier(nom) {
    return String(nom || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\b(fc|cf|sc|afc|ac|as|fk|sk)\b/g, "")
        .replace(/[^a-z0-9]/g, "");
}

function cleCalendrier(match) {
    return [match.date, normaliserEquipeCalendrier(match.domicile), normaliserEquipeCalendrier(match.exterieur)].join("|");
}

function convertirCalendrierDistant(donnees) {
    if (!Array.isArray(donnees?.matches)) return [];

    return donnees.matches
        .filter(match =>
            match &&
            /^\d{4}-\d{2}-\d{2}$/.test(match.date) &&
            typeof match.team1 === "string" && match.team1.trim() &&
            typeof match.team2 === "string" && match.team2.trim()
        )
        .map(match => {
            const score = Array.isArray(match.score) ? match.score : match.score?.ft;
            const scoreDisponible = Array.isArray(score) && score.length === 2 &&
                Number.isFinite(score[0]) && Number.isFinite(score[1]);

            return {
                date: match.date,
                heure: typeof match.time === "string" ? match.time : null,
                domicile: match.team1.trim(),
                exterieur: match.team2.trim(),
                butsDomicile: scoreDisponible ? score[0] : null,
                butsExterieur: scoreDisponible ? score[1] : null,
                scoreDisponible,
                championnat: donnees.name || "Premier League"
            };
        });
}

async function obtenirCalendrierActualise() {
    const maintenant = Date.now();
    if (cacheCalendrier && maintenant < cacheCalendrier.prochaineVerification) return cacheCalendrier;
    if (actualisationCalendrierEnCours) return actualisationCalendrierEnCours;

    actualisationCalendrierEnCours = (async () => {
        const verifieLe = new Date().toISOString();
        const saison = obtenirSaisonOpenFootball();
        const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${saison}/en.1.json`;

        try {
            const reponse = await axios.get(url, {
                timeout: 8000,
                headers: { Accept: "application/json" }
            });
            const matchsDistant = convertirCalendrierDistant(reponse.data);

            if (matchsDistant.length < 20) {
                throw new Error("Le calendrier distant est incomplet ou invalide.");
            }

            // Le calendrier distant remplace la Premier League locale; les autres compétitions locales restent disponibles.
            const autresMatchsLocaux = chargerCalendrierOpenFootball()
                .filter(match => !/premier league/i.test(match.championnat || ""));
            const matchsParCle = new Map();
            for (const match of [...autresMatchsLocaux, ...matchsDistant]) {
                matchsParCle.set(cleCalendrier(match), match);
            }

            const lastModified = reponse.headers?.["last-modified"];
            const dateSource = lastModified && Number.isFinite(Date.parse(lastModified))
                ? new Date(lastModified).toISOString()
                : null;

            console.log(`✅ Calendrier OpenFootball en ligne vérifié (${matchsDistant.length} matchs).`);
            return {
                matchs: [...matchsParCle.values()].sort((a, b) =>
                    a.date.localeCompare(b.date) || (a.heure || "").localeCompare(b.heure || "")
                ),
                source: `OpenFootball en ligne (${saison}) + autres fichiers locaux`,
                mode: "en_ligne",
                verifieLe,
                dateSource,
                avertissement: null,
                prochaineVerification: maintenant + CACHE_CALENDRIER_24H
            };
        } catch (error) {
            console.warn("⚠️ Calendrier en ligne indisponible; utilisation des fichiers locaux :", error.message);
            return {
                matchs: chargerCalendrierOpenFootball(),
                source: "Fichiers locaux OpenFootball (secours)",
                mode: "secours_local",
                verifieLe,
                dateSource: null,
                avertissement: "La source en ligne est indisponible. Le calendrier local de secours est utilisé.",
                prochaineVerification: maintenant + CACHE_RESECOURS_1H
            };
        }
    })();

    try {
        cacheCalendrier = await actualisationCalendrierEnCours;
        return cacheCalendrier;
    } finally {
        actualisationCalendrierEnCours = null;
    }
}

app.get("/api/matches/today", async (req, res) => {
    console.log("🔎 MATCHS DU JOUR — SOURCE OPENFOOTBALL");

    try {
        const calendrier = await obtenirCalendrierActualise();

        // Date du jour au Bénin, au format YYYY-MM-DD.
        const partiesDate = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Africa/Porto-Novo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(new Date());

        const valeursDate = Object.fromEntries(
            partiesDate.map(partie => [partie.type, partie.value])
        );

        const aujourdHui =
            `${valeursDate.year}-${valeursDate.month}-${valeursDate.day}`;

        const joursDemandes = Number.parseInt(req.query.jours, 10);
        const nombreJours = Number.isFinite(joursDemandes)
            ? Math.min(7, Math.max(1, joursDemandes))
            : 1;
        const datesAffichees = Array.from({ length: nombreJours }, (_, index) => {
            const date = new Date(`${aujourdHui}T12:00:00Z`);
            date.setUTCDate(date.getUTCDate() + index);
            return date.toISOString().slice(0, 10);
        });

        const matchs = calendrier.matchs
            .filter(match => datesAffichees.includes(match.date))
            .map((match, index) => ({
                id: `openfootball-${index + 1}`,

                championnat: {
                    id: null,
                    nom: match.championnat || "Championnat non précisé",
                    pays: "Inconnu",
                    logo: null
                },

                match: {
                    domicile: match.domicile,
                    exterieur: match.exterieur,
                    idDomicile: null,
                    idExterieur: null,
                    logoDomicile: null,
                    logoExterieur: null
                },

                date: match.date + (match.heure ? `T${match.heure}` : ""),

                statut: {
                    court: match.scoreDisponible ? "FT" : "NS",
                    description: match.scoreDisponible
                        ? "Résultat présent dans le calendrier source"
                        : "Match programmé — statut en direct indisponible",
                    minute: null
                },

                score: {
                    domicile: match.butsDomicile,
                    exterieur: match.butsExterieur
                },

                source: calendrier.source,
                directDisponible: false
            }));

        return res.json({
            success: true,
            source: calendrier.source,
            actualisation: {
                source: calendrier.source,
                mode: calendrier.mode,
                verifieLe: calendrier.verifieLe,
                dateSource: calendrier.dateSource,
                avertissement: calendrier.avertissement
            },
            date: aujourdHui,
            dates: datesAffichees,
            nombre: matchs.length,
            matchs,
            message: matchs.length
                ? `Matchs trouvés du ${datesAffichees[0]} au ${datesAffichees[datesAffichees.length - 1]}. Les scores en direct ne sont pas fournis par cette source.`
                : `Aucun match trouvé du ${datesAffichees[0]} au ${datesAffichees[datesAffichees.length - 1]} dans les calendriers disponibles.`
        });

    } catch (error) {
        console.error("❌ Erreur OpenFootball :", error.message);

        return res.status(500).json({
            success: false,
            message: "Impossible de lire les matchs OpenFootball.",
            erreur: error.message
        });
    }
});

// Résultats terminés récents : utilisés par l'application pour régler les pronostics enregistrés.
app.get("/api/matches/results", async (req, res) => {
    try {
        const calendrier = await obtenirCalendrierActualise();
        const depuisParametre = req.query?.depuis;
        const depuis = typeof depuisParametre === "string" && /^\d{4}-\d{2}-\d{2}$/.test(depuisParametre)
            ? depuisParametre
            : new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const matchs = Array.isArray(calendrier?.matchs) ? calendrier.matchs : [];
        const resultats = matchs
            .filter(match => match && match.scoreDisponible === true && typeof match.date === "string" && match.date >= depuis)
            .map(match => ({
                date: match.date,
                domicile: match.domicile,
                exterieur: match.exterieur,
                score: {
                    domicile: match.butsDomicile,
                    exterieur: match.butsExterieur
                },
                championnat: match.championnat
            }));

        return res.json({
            success: true,
            source: calendrier.source,
            verifieLe: calendario.verifieLe,
            depuis,
            nombre: resultats.length,
            resultats
        });
    } catch (error) {
        console.error("❌ Erreur lecture des résultats récents :", error.stack || error.message);
        return res.status(500).json({
            success: false,
            message: "Impossible de lire les résultats récents."
        });
    }
});

// ========================================
// PRÉDICTION D'UN MATCH
// ========================================

app.get("/api/predict/:fixtureId", verifierApiFootball, async (req, res) => {
    try {
        const fixtureId = req.params.fixtureId;

        if (!/^\d+$/.test(fixtureId)) {
            return res.status(400).json({
                success: false,
                message: "L'ID du match doit être numérique."
            });
        }

        const response = await apiFootball.get("/predictions", {
            params: {
                fixture: fixtureId
            }
        });

        const data = response.data?.response || [];

        if (data.length === 0) {

    console.log(
        `⚠️ API-Football ne fournit aucune prédiction pour le match ${fixtureId}.`
    );

    let fixture = null;

    try {
        const fixtureResponse = await apiFootball.get("/fixtures", {
            params: {
                id: fixtureId
            }
        });

        fixture = fixtureResponse.data?.response?.[0] || null;

    } catch (fixtureError) {

        console.error(
            "⚠️ Impossible de récupérer les informations du match :",
            fixtureError.response?.data || fixtureError.message
        );
    }

    let statistiques = [];

    try {
        const statisticsResponse = await apiFootball.get(
            "/fixtures/statistics",
            {
                params: {
                    fixture: fixtureId
                }
            }
        );

        statistiques =
            statisticsResponse.data?.response || [];

    } catch (statisticsError) {

        console.error(
            "⚠️ Statistiques indisponibles :",
            statisticsError.response?.data ||
            statisticsError.message
        );
    }

    const domicile =
        fixture?.teams?.home?.name ?? "Inconnu";

    const exterieur =
        fixture?.teams?.away?.name ?? "Inconnu";

    return res.json({
        success: true,

        fixtureId: Number(fixtureId),

        sourcePrediction:
            "DazyPredict — analyse statistique",

        qualiteDonnees:
            statistiques.length >= 2
                ? "partielle"
                : "insuffisante",

        match: {
            domicile,
            exterieur
        },

        analyse: {
            gagnant: null,

            victoireDomicile: null,
            nul: null,
            victoireExterieur: null,

            conseil:
                "Aucun pronostic fiable disponible : données statistiques insuffisantes.",

            overUnder: null,

            butsDomicile: null,
            butsExterieur: null
        },

        statistiques,

        forme: null,

        h2h: null,

        message:
            "API-Football ne fournit pas de prédiction pour ce match. DazyPredict n'invente aucune probabilité."
    });
}

        const prediction = data[0];
        const p = prediction.predictions || {};

        res.json({
            success: true,

            fixtureId: Number(fixtureId),

            match: {
                domicile: prediction.teams?.home?.name ?? "Inconnu",
                exterieur: prediction.teams?.away?.name ?? "Inconnu"
            },

            analyse: {
                gagnant: p.winner ?? null,

                victoireDomicile:
                    p.percent?.home ?? null,

                nul:
                    p.percent?.draw ?? null,

                victoireExterieur:
                    p.percent?.away ?? null,

                conseil:
                    p.advice ?? null,

                overUnder:
                    p.under_over ?? null,

                butsDomicile:
                    p.goals?.home ?? null,

                butsExterieur:
                    p.goals?.away ?? null
            },

            forme: p.form ?? null,
            h2h: p.h2h ?? null
        });

    } catch (error) {
        console.error(
            "❌ Erreur prédiction :",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            message: "Impossible d'analyser ce match",
            erreur: error.response?.data || error.message
        });
    }
});

// ========================================
// STATISTIQUES D'UN MATCH
// ========================================
function analyserEvenements(evenements, equipeDomicileId, equipeExterieureId) {

    let butsMatch = 0;
    let butsDomicile = 0;
    let butsExterieur = 0;
    let tirsAuBut = 0;

    let cartonsJaunes = 0;
    let cartonsRouges = 0;
    let remplacements = 0;

    const detailsButs = [];
    const detailsCartons = [];
    const detailsRemplacements = [];

    for (const evenement of evenements) {

        const type = (evenement.type || "").toLowerCase();
        const detail = (evenement.detail || "").toLowerCase();
        const comments = (evenement.comments || "").toLowerCase();

        const equipeId = evenement.team?.id ?? null;

        // 🎯 Séance de tirs au but
        const estTirAuBut =
            comments.includes("penalty shootout") ||
            detail.includes("penalty shootout");

        // ⚽ But
        if (type === "goal") {

            if (estTirAuBut) {

                tirsAuBut++;

            } else {

                butsMatch++;

                if (equipeId === equipeDomicileId) {
                    butsDomicile++;
                }

                if (equipeId === equipeExterieureId) {
                    butsExterieur++;
                }

                detailsButs.push({
                    minute: evenement.time?.elapsed ?? null,
                    equipe: evenement.team?.name ?? "Inconnue",
                    joueur: evenement.player?.name ?? null,
                    detail: evenement.detail ?? null
                });
            }
        }

        // 🟨 / 🟥 Cartons
        if (type === "card") {

            if (detail.includes("yellow")) {
                cartonsJaunes++;
            }

            if (
                detail.includes("red") ||
                detail.includes("second yellow")
            ) {
                cartonsRouges++;
            }

            detailsCartons.push({
                minute: evenement.time?.elapsed ?? null,
                equipe: evenement.team?.name ?? "Inconnue",
                joueur: evenement.player?.name ?? null,
                detail: evenement.detail ?? null
            });
        }

        // 🔄 Remplacements
        if (type === "subst") {

            remplacements++;

            detailsRemplacements.push({
                minute: evenement.time?.elapsed ?? null,
                equipe: evenement.team?.name ?? "Inconnue",
                joueurEntrant: evenement.player?.name ?? null,
                joueurSortant: evenement.assist?.name ?? null
            });
        }
    }

    return {
        butsMatch,
        butsDomicile,
        butsExterieur,
        tirsAuBut,

        cartonsJaunes,
        cartonsRouges,

        remplacements,

        detailsButs,
        detailsCartons,
        detailsRemplacements
    };
}
app.get("/api/fixtures/:fixtureId/events", verifierApiFootball, async (req, res) => {
    const { fixtureId } = req.params;

    try {
        const response = await apiFootball.get("/fixtures/events", {
            params: {
                fixture: fixtureId
            }
        });

        const evenements = response.data?.response || [];

const fixtureResponse = await apiFootball.get("/fixtures", {
    params: {
        id: fixtureId
    }
});

const fixture = fixtureResponse.data?.response?.[0];

const equipeDomicileId = fixture?.teams?.home?.id ?? null;
const equipeExterieureId = fixture?.teams?.away?.id ?? null;

const analyseEvenements = analyserEvenements(
    evenements,
    equipeDomicileId,
    equipeExterieureId
);

res.json({
    success: true,
    fixtureId: Number(fixtureId),
    nombreEvenements: evenements.length,
    evenements,
    analyseEvenements
});

    } catch (error) {
        console.error(
            "⚠️ Impossible de récupérer les événements :",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            fixtureId: Number(fixtureId),
            message: "Impossible de récupérer les événements du match."
        });
    }
});
app.get("/api/match/:fixtureId/statistics", verifierApiFootball, async (req, res) => {
    try {
        const fixtureId = req.params.fixtureId;

        if (!/^\d+$/.test(fixtureId)) {
            return res.status(400).json({
                success: false,
                message: "L'ID du match doit être numérique."
            });
        }

        const response = await apiFootball.get(
            "/fixtures/statistics",
            {
                params: {
                    fixture: fixtureId
                }
            }
        );

        const statistics = (response.data?.response || []).map(
            teamData => ({
                equipe: teamData.team?.name ?? "Inconnu",
                logo: teamData.team?.logo ?? null,
                statistiques: teamData.statistics || []
            })
        );

        res.json({
            success: true,
            fixtureId: Number(fixtureId),
            nombreEquipes: statistics.length,
            statistiques: statistics
        });

    } catch (error) {
        console.error(
            "❌ Erreur statistiques :",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            message: "Impossible de récupérer les statistiques",
            erreur: error.response?.data || error.message
        });
    }
});

// ========================================
// FORME RÉCENTE D'UNE ÉQUIPE
// ========================================

app.get("/api/team/:teamId/form", verifierApiFootball, async (req, res) => {
    try {
        const teamId = req.params.teamId;

        if (!/^\d+$/.test(teamId)) {
            return res.status(400).json({
                success: false,
                message: "L'ID de l'équipe doit être numérique."
            });
        }

        console.log(`📈 Recherche de la forme de l'équipe ${teamId}...`);

        // ========================================
        // 1. PREMIÈRE TENTATIVE : 5 DERNIERS MATCHS
        // ========================================

        let response = await apiFootball.get("/fixtures", {
            params: {
                team: teamId,
                last: 5
            }
        });

        let fixtures = response.data?.response || [];

        console.log(
            `📊 Première recherche : ${fixtures.length} match(s)`
        );

        // ========================================
        // 2. DEUXIÈME TENTATIVE : SAISON 2026
        // ========================================

        if (fixtures.length === 0) {
            console.log(
                "🔄 Aucun résultat. Recherche avec la saison 2026..."
            );

            response = await apiFootball.get("/fixtures", {
                params: {
                    team: teamId,
                    season: 2026,
                    last: 5
                }
            });

            fixtures = response.data?.response || [];

            console.log(
                `📊 Recherche saison 2026 : ${fixtures.length} match(s)`
            );
        }

        // ========================================
        // TRANSFORMATION DES MATCHS
        // ========================================

        const matchs = fixtures.map(match => {

            const homeId = match.teams?.home?.id;

            const isHome =
                Number(homeId) === Number(teamId);

            const butsPour = isHome
                ? match.goals?.home
                : match.goals?.away;

            const butsContre = isHome
                ? match.goals?.away
                : match.goals?.home;

            let resultat = "INCONNU";

            if (
                typeof butsPour === "number" &&
                typeof butsContre === "number"
            ) {
                if (butsPour > butsContre) {
                    resultat = "V";
                } else if (butsPour === butsContre) {
                    resultat = "N";
                } else {
                    resultat = "D";
                }
            }

            return {
                id: match.fixture?.id ?? null,

                date: match.fixture?.date ?? null,

                championnat:
                    match.league?.name ?? "Inconnu",

                domicile:
                    match.teams?.home?.name ?? "Inconnu",

                exterieur:
                    match.teams?.away?.name ?? "Inconnu",

                scoreDomicile:
                    match.goals?.home ?? null,

                scoreExterieur:
                    match.goals?.away ?? null,

                butsPour,
                butsContre,

                resultat,

                statut:
                    match.fixture?.status?.short ?? null
            };
        });

        // ========================================
        // MATCHS TERMINÉS UNIQUEMENT
        // ========================================

        const matchsTermines = matchs.filter(match =>
            typeof match.butsPour === "number" &&
            typeof match.butsContre === "number"
        );

        // ========================================
        // CALCUL DE LA FORME
        // ========================================

        const victoires = matchsTermines.filter(
            match => match.resultat === "V"
        ).length;

        const nuls = matchsTermines.filter(
            match => match.resultat === "N"
        ).length;

        const defaites = matchsTermines.filter(
            match => match.resultat === "D"
        ).length;

        const butsPourTotal = matchsTermines.reduce(
            (total, match) =>
                total + match.butsPour,
            0
        );

        const butsContreTotal = matchsTermines.reduce(
            (total, match) =>
                total + match.butsContre,
            0
        );

        const nombreTermines =
            matchsTermines.length;

        const moyenneButsPour =
            nombreTermines > 0
                ? Number(
                    (
                        butsPourTotal /
                        nombreTermines
                    ).toFixed(2)
                )
                : 0;

        const moyenneButsContre =
            nombreTermines > 0
                ? Number(
                    (
                        butsContreTotal /
                        nombreTermines
                    ).toFixed(2)
                )
                : 0;

        // ========================================
        // RÉPONSE
        // ========================================

        res.json({
            success: true,

            teamId: Number(teamId),

            nombre: matchs.length,

            forme: {
                victoires,
                nuls,
                defaites,

                sequence:
                    matchsTermines.map(
                        match => match.resultat
                    ),

                butsPour: butsPourTotal,

                butsContre:
                    butsContreTotal,

                moyenneButsPour,

                moyenneButsContre
            },

            matchs
        });

    } catch (error) {

        console.error(
            "❌ Erreur forme équipe :",
            error.response?.data ||
            error.message
        );

        res.status(500).json({
            success: false,

            message:
                "Impossible de récupérer la forme de l'équipe",

            erreur:
                error.response?.data ||
                error.message
        });

    }
});

 // ========================================
 // PRÉDICTION AUTONOME — SANS API-FOOTBALL
 // ========================================

 app.get("/api/autonome/predict", async (req, res) => {
     try {
         const domicile = req.query.domicile;
         const exterieur = req.query.exterieur;
         const dateReference = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
             ? req.query.date
             : new Date().toISOString().slice(0, 10);
         const competition = typeof req.query.competition === "string" ? req.query.competition : "";

         if (!domicile || !exterieur) {
             return res.status(400).json({
                 success: false,
                 message: "Précise les paramètres domicile et exterieur."
             });
         }

         const matchsParCle = new Map();
         const cleHistorique = match => [
             match.date,
             normaliserNomEquipe(match.domicile),
             normaliserNomEquipe(match.exterieur)
         ].join("|");

         for (const match of chargerMatchsHistoriques()) {
             matchsParCle.set(cleHistorique(match), match);
         }

         // Les résultats terminés de la source du calendrier complètent l'historique local.
         // Ils remplacent les éventuels doublons et le moteur exclut ensuite tout match futur.
         const calendrier = await obtenirCalendrierActualise();
         for (const match of calendrier.matchs) {
             if (match.scoreDisponible && match.date < dateReference) {
                 matchsParCle.set(cleHistorique(match), match);
             }
         }

         const resultat = calculerProbabilites(
             [...matchsParCle.values()],
             domicile,
             exterieur,
             { dateReference, competition }
         );

         if (resultat.success) {
             resultat.sourceCalendrier = calendrier.source;
             resultat.verifieLe = calendrier.verifieLe;
             resultat.modeCalendrier = calendrier.mode;
         }

         return res.json(resultat);

     } catch (error) {
         console.error("Erreur prédiction autonome :", error.message);

         return res.status(500).json({
             success: false,
             message: "Impossible de calculer la prédiction autonome."
         });
     }
 });

// ========================================
// SERVEUR
// ========================================

app.listen(PORT, () => {
    console.log("");
    console.log("======================================");
    console.log("⚽ DAZYPREDICT BACKEND");
    console.log("======================================");
    console.log(`🚀 Serveur : http://localhost:${PORT}`);
    console.log(
        `📊 Matchs : http://localhost:${PORT}/api/matches/today`
    );
    console.log(
        `🧪 API : http://localhost:${PORT}/api/test`
    );
    console.log(
        `📈 Forme : http://localhost:${PORT}/api/team/15990/form`
    );
    console.log("======================================");
    console.log("");
});
