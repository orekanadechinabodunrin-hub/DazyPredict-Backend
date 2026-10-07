require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
const PORT = 3000;

app.use(express.json());

// ========================================
// VÃ‰RIFICATION DE LA CLÃ‰ API
// ========================================

if (!process.env.API_FOOTBALL_KEY) {
    console.error("âŒ API_FOOTBALL_KEY est manquante dans .env");
    process.exit(1);
}

console.log("âœ… ClÃ© API-Football dÃ©tectÃ©e");

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
            message: "Connexion API-Football rÃ©ussie",
            api: {
                status: response.data?.response?.account
                    ? "connectÃ©e"
                    : "connectÃ©e"
            }
        });

    } catch (error) {
        console.error(
            "âŒ Erreur API-Football :",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            message: "Connexion Ã  API-Football impossible",
            erreur: error.response?.data || error.message
        });
    }
});

// ========================================
// MATCHS DU JOUR
// ========================================

app.get("/api/matches/today", async (req, res) => {
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
            "âŒ Erreur matchs :",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            message: "Impossible de rÃ©cupÃ©rer les matchs",
            erreur: error.response?.data || error.message
        });
    }
});

// ========================================
// PRÃ‰DICTION D'UN MATCH
// ========================================

app.get("/api/predict/:fixtureId", async (req, res) => {
    try {
        const fixtureId = req.params.fixtureId;

        if (!/^\d+$/.test(fixtureId)) {
            return res.status(400).json({
                success: false,
                message: "L'ID du match doit Ãªtre numÃ©rique."
            });
        }

        const response = await apiFootball.get("/predictions", {
            params: {
                fixture: fixtureId
            }
        });

        const data = response.data?.response || [];

        if (data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Aucune prÃ©diction disponible pour ce match."
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
            "âŒ Erreur prÃ©diction :",
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

app.get("/api/match/:fixtureId/statistics", async (req, res) => {
    try {
        const fixtureId = req.params.fixtureId;

        if (!/^\d+$/.test(fixtureId)) {
            return res.status(400).json({
                success: false,
                message: "L'ID du match doit Ãªtre numÃ©rique."
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
            statistiques
        });

    } catch (error) {
        console.error(
            "âŒ Erreur statistiques :",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            message: "Impossible de rÃ©cupÃ©rer les statistiques",
            erreur: error.response?.data || error.message
        });
    }
});

// ========================================
// FORME RÃ‰CENTE D'UNE Ã‰QUIPE
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

        const aujourdHui = new Date();
        const dateFin = aujourdHui.toISOString().slice(0, 10);

        const dateDebutObj = new Date(aujourdHui);
        dateDebutObj.setDate(dateDebutObj.getDate() - 90);

        const dateDebut = dateDebutObj.toISOString().slice(0, 10);

        console.log(`📅 Recherche du ${dateDebut} au ${dateFin}...`);

        const response = await apiFootball.get("/fixtures", {
            params: {
                league: 734,
                season: 2026,
                from: dateDebut,
                to: dateFin
            }
        });

        let fixtures = response.data?.response || [];

        console.log(
            `📊 Matchs récupérés de Diski Challenge : ${fixtures.length}`
        );

        fixtures = fixtures.filter(match =>
            Number(match.teams?.home?.id) === Number(teamId) ||
            Number(match.teams?.away?.id) === Number(teamId)
        );

        console.log(
            `📈 Matchs trouvés pour l'équipe ${teamId} : ${fixtures.length}`
        );

        const matchs = fixtures.map(match => {
            const isHome =
                Number(match.teams?.home?.id) === Number(teamId);

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
                championnat: match.league?.name ?? "Inconnu",
                domicile: match.teams?.home?.name ?? "Inconnu",
                exterieur: match.teams?.away?.name ?? "Inconnu",
                scoreDomicile: match.goals?.home ?? null,
                scoreExterieur: match.goals?.away ?? null,
                butsPour,
                butsContre,
                resultat,
                statut: match.fixture?.status?.short ?? null
            };
        });

        const matchsTermines = matchs.filter(match =>
            typeof match.butsPour === "number" &&
            typeof match.butsContre === "number"
        );

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
            (total, match) => total + match.butsPour,
            0
        );

        const butsContreTotal = matchsTermines.reduce(
            (total, match) => total + match.butsContre,
            0
        );

        const nombreTermines = matchsTermines.length;

        const moyenneButsPour =
            nombreTermines > 0
                ? Number((butsPourTotal / nombreTermines).toFixed(2))
                : 0;

        const moyenneButsContre =
            nombreTermines > 0
                ? Number((butsContreTotal / nombreTermines).toFixed(2))
                : 0;

        res.json({
            success: true,
            teamId: Number(teamId),

            periode: {
                debut: dateDebut,
                fin: dateFin
            },

            nombre: matchs.length,

            forme: {
                victoires,
                nuls,
                defaites,

                sequence: matchsTermines.map(
                    match => match.resultat
                ),

                butsPour: butsPourTotal,
                butsContre: butsContreTotal,

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
            message: "Impossible de récupérer la forme de l'équipe",
            erreur:
                error.response?.data ||
                error.message
        });
    }
});


// ========================================
// COMPÉTITIONS D'UNE ÉQUIPE
// ========================================

app.get("/api/team/:teamId/leagues", async (req, res) => {
    try {
        const teamId = req.params.teamId;

        if (!/^\d+$/.test(teamId)) {
            return res.status(400).json({
                success: false,
                message: "L'ID de l'équipe doit être numérique."
            });
        }

        console.log(`🏆 Recherche des compétitions de l'équipe ${teamId}...`);

        const response = await apiFootball.get("/leagues", {
            params: {
                team: teamId
            }
        });

        const competitions = response.data?.response || [];

        res.json({
            success: true,
            teamId: Number(teamId),
            nombre: competitions.length,
            competitions
        });

    } catch (error) {
        console.error(
            "❌ Erreur compétitions équipe :",
            error.response?.data ||
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Impossible de récupérer les compétitions de l'équipe",
            erreur:
                error.response?.data ||
                error.message
        });
    }
});
// ========================================
// SERVEUR
// ========================================

app.listen(PORT, () => {
    console.log("");
    console.log("======================================");
    console.log("âš½ DAZYPREDICT BACKEND");
    console.log("======================================");
    console.log(`ðŸš€ Serveur : http://localhost:${PORT}`);
    console.log(
        `ðŸ“Š Matchs : http://localhost:${PORT}/api/matches/today`
    );
    console.log(
        `ðŸ§ª API : http://localhost:${PORT}/api/test`
    );
    console.log(
        `ðŸ“ˆ Forme : http://localhost:${PORT}/api/team/15990/form`
    );
    console.log("======================================");
    console.log("");
});



