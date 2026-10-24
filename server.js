
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { chargerMatchsHistoriques } = require("./adaptateur_openfootball");
const { calculerProbabilites } = require("./moteur_dazypredict");

const app = express();
const PORT = 3000;

app.use(express.json());

// ========================================
// VÉRIFICATION DE LA CLÉ API
// ========================================

if (!process.env.API_FOOTBALL_KEY) {
    console.error("❌ API_FOOTBALL_KEY est manquante dans .env");
    process.exit(1);
}

console.log("✅ Clé API-Football détectée");

// ========================================
// CONNEXION API-FOOTBALL
// ========================================

const apiFootball = axios.create({
    baseURL: "https://v3.football.api-sports.io",
    headers: {
        "x-apisports-key": process.env.API_FOOTBALL_KEY
    },
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

app.get("/api/test", async (req, res) => {
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

app.get("/api/matches/today", async (req, res) => {
    console.log("🔎 DEMANDE MATCHS DU JOUR REÇUE");
    try {
        const today = new Date().toISOString().slice(0, 10);

        const response = await apiFootball.get("/fixtures", {
            params: {
                date: today
            }
        });
       
        const matches = (response.data?.response || []).map(match => ({
            id: match.fixture?.id ?? null,

            championnat: {
                id: match.league?.id ?? null,
                nom: match.league?.name ?? "Inconnu",
                pays: match.league?.country ?? "Inconnu",
                logo: match.league?.logo ?? null
            },

            match: {
                domicile: match.teams?.home?.name ?? "Inconnu",
                exterieur: match.teams?.away?.name ?? "Inconnu",

                idDomicile: match.teams?.home?.id ?? null,
                idExterieur: match.teams?.away?.id ?? null,

                logoDomicile: match.teams?.home?.logo ?? null,
                logoExterieur: match.teams?.away?.logo ?? null
            },

            date: match.fixture?.date ?? null,

            statut: {
                court: match.fixture?.status?.short ?? null,
                description: match.fixture?.status?.long ?? null,
                minute: match.fixture?.status?.elapsed ?? null
            },

            score: {
                domicile: match.goals?.home ?? null,
                exterieur: match.goals?.away ?? null
            }
        }));

        res.json({
            success: true,
            nombre: matches.length,
            matchs: matches
        });

    } catch (error) {
        console.error(
            "❌ Erreur matchs :",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            message: "Impossible de récupérer les matchs",
            erreur: error.response?.data || error.message
        });
    }
});

// ========================================
// PRÉDICTION D'UN MATCH
// ========================================

app.get("/api/predict/:fixtureId", async (req, res) => {
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
app.get("/api/fixtures/:fixtureId/events", async (req, res) => {
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
app.get("/api/match/:fixtureId/statistics", async (req, res) => {
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

app.get("/api/team/:teamId/form", async (req, res) => {
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

 app.get("/api/autonome/predict", (req, res) => {
     try {
         const domicile = req.query.domicile;
         const exterieur = req.query.exterieur;

         if (!domicile || !exterieur) {
             return res.status(400).json({
                 success: false,
                 message: "Précise les paramètres domicile et exterieur."
             });
         }

         const matchs = chargerMatchsHistoriques();

         const resultat = calculerProbabilites(
             matchs,
             domicile,
             exterieur
         );

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