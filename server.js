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
// CONNEXION ODDIZE — TEST GRATUIT DES SPORTS
// ========================================

const oddizeApi = axios.create({
    baseURL: "https://oddize.com/api/v1",
    timeout: 10000,
    headers: {
        Accept: "application/json"
    }
});

app.get("/api/oddize/sports", async (req, res) => {
    if (!process.env.ODDIZE_API_KEY) {
        return res.status(503).json({
            success: false,
            message: "La clé Oddize n'est pas configurée sur le serveur."
        });
    }

    try {
        const response = await oddizeApi.get("/sports", {
            headers: {
                "X-API-Key": process.env.ODDIZE_API_KEY
            }
        });

        const sports = Array.isArray(response.data?.sports)
            ? response.data.sports
            : [];

        return res.json({
            success: true,
            source: "Oddize",
            nombreSports: sports.length,
            sports
        });
    } catch (error) {
        console.error(
            "Erreur Oddize /sports :",
            error.response?.status || error.message
        );

       return res.status(502).json({
    success: false,
    message: "Impossible de récupérer les sports auprès d'Oddize.",
    statutSource: error.response?.status || null,
    detailsSource: error.response?.data?.message
        || error.response?.data?.detail
        || error.response?.data?.error
        || "Oddize n'a fourni aucun détail."
});
    }
});
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

const CACHE_RESULTATS_ESPN_MS = 5 * 60 * 1000;
const cacheResultatsEspn = new Map();
const requetesResultatsEspnEnCours = new Map();

async function obtenirResultatsEspn(date, ligue) {
    const cle = `${date}|${ligue}`;
    const cache = cacheResultatsEspn.get(cle);
    if (cache && cache.expire > Date.now()) return cache.resultats;
    if (requetesResultatsEspnEnCours.has(cle)) return requetesResultatsEspnEnCours.get(cle);

    const requete = (async () => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ligue}/scoreboard?dates=${date.replace(/-/g, "")}`;
        const reponse = await axios.get(url, { timeout: 12000, headers: { Accept: "application/json" } });
        const resultats = (Array.isArray(reponse.data?.events) ? reponse.data.events : [])
            .filter(event => event?.status?.type?.completed === true)
            .map(event => {
                const competition = event.competitions?.[0];
                const participants = Array.isArray(competition?.competitors) ? competition.competitors : [];
                const domicile = participants.find(team => team.homeAway === "home");
                const exterieur = participants.find(team => team.homeAway === "away");
                const butsDomicile = Number(domicile?.score);
                const butsExterieur = Number(exterieur?.score);
                if (!domicile?.team?.displayName || !exterieur?.team?.displayName ||
                    !Number.isFinite(butsDomicile) || !Number.isFinite(butsExterieur)) return null;
                return {
                    date: String(event.date || date).slice(0, 10),
                    domicile: domicile.team.displayName,
                    exterieur: exterieur.team.displayName,
                    score: { domicile: butsDomicile, exterieur: butsExterieur },
                    championnat: event.season?.slug || ligue
                };
            }).filter(Boolean);
        cacheResultatsEspn.set(cle, { resultats, expire: Date.now() + CACHE_RESULTATS_ESPN_MS });
        if (cacheResultatsEspn.size > 200) {
            const plusAncienneCle = cacheResultatsEspn.keys().next().value;
            if (plusAncienneCle) cacheResultatsEspn.delete(plusAncienneCle);
        }
        return resultats;
    })();

    requetesResultatsEspnEnCours.set(cle, requete);
    try {
        return await requete;
    } finally {
        requetesResultatsEspnEnCours.delete(cle);
    }
}

function cleCalendrier(match) {
    return [match.date, normaliserEquipeCalendrier(match.domicile), normaliserEquipeCalendrier(match.exterieur)].join("|");
}

function appliquerCorrectionsCalendrier(matchs) {
    // La LFP a officiellement déplacé PSG–Lyon du 25 au 26 octobre 2026.
    // OpenFootball peut conserver l'horaire initial pendant un délai; appliquer
    // cette correction vérifiée au calendrier distant comme au secours local.
    const estPsgLyon = match => {
        const domicile = normaliserEquipeCalendrier(match.domicile);
        const exterieur = normaliserEquipeCalendrier(match.exterieur);
        return (domicile.includes("parissaintgermain") || domicile === "psg") &&
            (exterieur.includes("olympiquelyonnais") || exterieur === "lyon" || exterieur === "ol");
    };

    const psgLyon = matchs.filter(estPsgLyon);
    if (psgLyon.length === 0) {
        psgLyon.push({
            domicile: "Paris Saint-Germain FC",
            exterieur: "Olympique Lyonnais",
            championnat: "French Ligue 1 2026/27",
            scoreDisponible: false,
            butsDomicile: null,
            butsExterieur: null
        });
    }

    const sourceAvecScore = psgLyon.find(match => match.scoreDisponible === true);
    if (!sourceAvecScore && Date.now() > Date.parse("2026-10-26T20:30:00+01:00")) {
        return matchs.filter(match => !estPsgLyon(match));
    }

    const matchCorrige = {
        ...(sourceAvecScore || psgLyon.find(match => match.date === "2026-10-26") || psgLyon[0]),
        date: "2026-10-26",
        heure: "20:30",
        championnat: psgLyon.find(match => match.championnat)?.championnat || "French Ligue 1 2026/27"
    };

    return [
        ...matchs.filter(match => !estPsgLyon(match)),
        matchCorrige
    ];
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
        // OpenFootball publie des fichiers séparés pour chaque championnat.
        // Garder la Premier League comme source principale et charger aussi
        // les grands championnats européens disponibles dans le même dépôt.
        const championnatsOpenFootball = [
            { fichier: "en.1.json", principal: true }, // Premier League
            { fichier: "en.2.json" },                 // Championship
            { fichier: "de.1.json" },                 // Bundesliga
            { fichier: "es.1.json" },                 // La Liga
            { fichier: "fr.1.json" },                 // Ligue 1
            { fichier: "it.1.json" },                 // Serie A
            { fichier: "nl.1.json" },                 // Eredivisie
            { fichier: "pt.1.json" }                  // Primeira Liga
        ];

        try {
            const reponses = await Promise.allSettled(
                championnatsOpenFootball.map(async championnat => {
                    const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${saison}/${championnat.fichier}`;
                    const reponse = await axios.get(url, {
                        timeout: 8000,
                        headers: { Accept: "application/json" }
                    });
                    return {
                        principal: championnat.principal === true,
                        matchs: convertirCalendrierDistant(reponse.data),
                        lastModified: reponse.headers?.["last-modified"] || null
                    };
                })
            );

            const calendriersDistants = reponses
                .filter(resultat => resultat.status === "fulfilled" && resultat.value.matchs.length > 0)
                .map(resultat => resultat.value);
            const calendrierPrincipal = calendriersDistants.find(calendrier => calendrier.principal);

            if (!calendrierPrincipal || calendrierPrincipal.matchs.length < 20) {
                throw new Error("Le calendrier distant de Premier League est incomplet ou invalide.");
            }

            const matchsDistant = calendriersDistants.flatMap(calendrier => calendrier.matchs);

            // Toujours conserver les calendriers embarqués : ils complètent une
            // source distante partielle ou momentanément inaccessible. Quand
            // une source distante contient le même match, elle remplace la copie locale.
            const matchsLocaux = chargerCalendrierOpenFootball();
            const matchsParCle = new Map();
            for (const match of [...matchsLocaux, ...matchsDistant]) {
                matchsParCle.set(cleCalendrier(match), match);
            }

            const lastModified = calendrierPrincipal.lastModified;
            const dateSource = lastModified && Number.isFinite(Date.parse(lastModified))
                ? new Date(lastModified).toISOString()
                : null;

            const nombreChampionnats = calendriersDistants.length;
            console.log(`✅ Calendrier OpenFootball en ligne vérifié (${nombreChampionnats} championnats, ${matchsDistant.length} matchs).`);
            return {
                matchs: appliquerCorrectionsCalendrier([...matchsParCle.values()]).sort((a, b) =>
                    a.date.localeCompare(b.date) || (a.heure || "").localeCompare(b.heure || "")
                ),
                source: `OpenFootball en ligne (${saison}, ${nombreChampionnats} championnats) + calendriers locaux`,
                mode: "en_ligne",
                verifieLe,
                dateSource,
                avertissement: null,
                prochaineVerification: maintenant + CACHE_CALENDRIER_24H
            };
        } catch (error) {
            console.warn("⚠️ Calendrier en ligne indisponible; utilisation des fichiers locaux :", error.message);
            return {
                matchs: appliquerCorrectionsCalendrier(chargerCalendrierOpenFootball()),
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
        const resultatsOpenFootball = matchs
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

        // L'API publique ESPN fournit les scores finaux même lorsque le calendrier
        // OpenFootball n'a pas encore publié les résultats. L'application envoie
        // seulement les dates réellement nécessaires (prévisions encore en attente).
        const datesParametre = typeof req.query?.dates === "string"
            ? [...new Set(req.query.dates.split(",").filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))].slice(0, 14)
            : [];
        const dates = datesParametre.length > 0
            ? datesParametre
            : [depuis].filter(date => date >= new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
        const liguesEspn = ["eng.1", "eng.2", "fra.1", "esp.1", "ger.1", "ita.1", "ned.1", "por.1"];
        const resultatsEspn = (await Promise.allSettled(dates.flatMap(date =>
            liguesEspn.map(ligue => obtenirResultatsEspn(date, ligue))
        ))).flatMap(resultat => resultat.status === "fulfilled" ? resultat.value : []);

        const resultatsParMatch = new Map();
        for (const resultat of [...resultatsOpenFootball, ...resultatsEspn]) {
            const cle = [resultat.date, normaliserEquipeCalendrier(resultat.domicile), normaliserEquipeCalendrier(resultat.exterieur)].join("|");
            resultatsParMatch.set(cle, resultat);
        }
        const resultats = [...resultatsParMatch.values()];

        return res.json({
            success: true,
            source: resultatsEspn.length > 0 ? "ESPN + " + calendrier.source : calendrier.source + " (ESPN indisponible ou aucun résultat ce jour)",
            verifieLe: calendrier.verifieLe,
            depuis,
            datesInterrogees: dates,
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
