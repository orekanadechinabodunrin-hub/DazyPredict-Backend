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
    const teamId = Number(req.params.teamId);
    const saison = new Date().getFullYear();

    try {
        console.log(`📈 Recherche de la forme de l'équipe ${teamId}...`);

        const response = await apiFootball.get("/fixtures", {
            params: {
                team: teamId,
                season: saison,
                last: 5
            }
        });

        const erreurs = response.data?.errors || {};

        if (Object.keys(erreurs).length > 0) {
            console.log(`⚠️ API-Football : ${JSON.stringify(erreurs)}`);

            return res.json({
                success: true,
                disponible: false,
                teamId,
                saison,
                raison: "historique_non_accessible",
                message: "Les données de forme ne sont pas accessibles avec le forfait API-Football actuel.",
                erreurs_api: erreurs,
                forme: null,
                matchs: []
            });
        }

        const fixtures = response.data?.response || [];

        if (!fixtures.length) {
            return res.json({
                success: true,
                disponible: false,
                teamId,
                saison,
                raison: "aucun_match_accessible",
                message: "Aucun match accessible pour cette équipe avec les paramètres actuels.",
                forme: null,
                matchs: []
            });
        }

        let victoires = 0;
        let nuls = 0;
        let defaites = 0;
        let butsPour = 0;
        let butsContre = 0;
        const sequence = [];

        fixtures.forEach(match => {
            const homeId = Number(match.teams?.home?.id);
            const awayId = Number(match.teams?.away?.id);
            const homeGoals = Number(match.goals?.home ?? 0);
            const awayGoals = Number(match.goals?.away ?? 0);

            if (homeId === teamId) {
                butsPour += homeGoals;
                butsContre += awayGoals;

                if (homeGoals > awayGoals) {
                    victoires++;
                    sequence.push("V");
                } else if (homeGoals === awayGoals) {
                    nuls++;
                    sequence.push("N");
                } else {
                    defaites++;
                    sequence.push("D");
                }
            } else if (awayId === teamId) {
                butsPour += awayGoals;
                butsContre += homeGoals;

                if (awayGoals > homeGoals) {
                    victoires++;
                    sequence.push("V");
                } else if (awayGoals === homeGoals) {
                    nuls++;
                    sequence.push("N");
                } else {
                    defaites++;
                    sequence.push("D");
                }
            }
        });

        const nombre = fixtures.length;

        return res.json({
            success: true,
            disponible: true,
            teamId,
            saison,
            nombre,
            forme: {
                victoires,
                nuls,
                defaites,
                sequence,
                butsPour,
                butsContre,
                moyenneButsPour: nombre ? Number((butsPour / nombre).toFixed(2)) : 0,
                moyenneButsContre: nombre ? Number((butsContre / nombre).toFixed(2)) : 0
            },
            matchs: fixtures
        });

    } catch (error) {
        const apiError = error.response?.data?.errors || null;

        console.error("❌ Erreur forme :", apiError || error.message);

        return res.status(500).json({
            success: false,
            disponible: false,
            teamId,
            saison,
            raison: "erreur_api",
            erreurs_api: apiError,
            message: "Impossible de récupérer la forme de l'équipe."
        });
    }
});
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




