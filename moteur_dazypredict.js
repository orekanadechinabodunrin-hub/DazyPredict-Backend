/**
 * DAZYPREDICT — moteur statistique expérimental.
 * Estime les buts avec des moyennes domicile/extérieur pondérées par la récence,
 * puis calcule les probabilités 1X2 à partir d'une distribution de Poisson.
 * Aucun service IA payant ni appel à une IA générative.
 */

const DEMI_VIE_JOURS = 180;
const MATCHS_PRIOR = 5;
const MAX_BUTS_CALCUL = 10;

function calculerMoyenne(valeurs) {
  if (!Array.isArray(valeurs) || valeurs.length === 0) return 0;
  return valeurs.reduce((total, valeur) => total + Number(valeur || 0), 0) / valeurs.length;
}

function normaliserNomEquipe(nom) {
  return String(nom || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|ac|as|fk|sk)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normaliserCompetition(nom) {
  return String(nom || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\s*[-/]\s*\d{2,4}\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function extraireScore(match) {
  if (!match || typeof match !== "object") return null;
  if (match.butsDomicile != null && match.butsExterieur != null) {
    const butsDomicile = Number(match.butsDomicile);
    const butsExterieur = Number(match.butsExterieur);

    if (
      Number.isInteger(butsDomicile) &&
      Number.isInteger(butsExterieur) &&
      butsDomicile >= 0 && butsDomicile <= 20 &&
      butsExterieur >= 0 && butsExterieur <= 20
    ) {
      return [butsDomicile, butsExterieur];
    }
  }

  const raw = Array.isArray(match.score) ? match.score : match.score?.ft;
  if (
    Array.isArray(raw) &&
    raw.length === 2 &&
    Number.isInteger(raw[0]) &&
    Number.isInteger(raw[1]) &&
    raw[0] >= 0 && raw[0] <= 20 &&
    raw[1] >= 0 && raw[1] <= 20
  ) {
    return raw;
  }

  return null;
}

function dateValide(date) {
  return typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date + "T00:00:00Z"));
}

function valeurPoisson(lambda, buts) {
  if (buts === 0) return Math.exp(-lambda);
  let valeur = Math.exp(-lambda);
  for (let i = 1; i <= buts; i++) valeur *= lambda / i;
  return valeur;
}

function arrondirProbabilites(probas) {
  const exactes = probas.map(valeur => Math.max(0, valeur) * 100);
  const entieres = exactes.map(Math.floor);
  let restantes = 100 - entieres.reduce((somme, valeur) => somme + valeur, 0);
  const ordre = exactes
    .map((valeur, index) => ({ index, reste: valeur - entieres[index] }))
    .sort((a, b) => b.reste - a.reste);

  for (let i = 0; i < restantes; i++) {
    entieres[ordre[i % ordre.length].index] += 1;
  }

  return entieres;
}

function analyserEquipe(matchs, nomEquipe, domicile = true, avantDate = null) {
  const role = domicile ? "domicile" : "exterieur";
  const selection = (Array.isArray(matchs) ? matchs : [])
    .filter(match => {
      const score = extraireScore(match);
      return score &&
        dateValide(match.date) &&
        (!avantDate || match.date < avantDate) &&
        normaliserNomEquipe(match[role]) === normaliserNomEquipe(nomEquipe);
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  const butsMarques = selection.map(match => {
    const score = extraireScore(match);
    return domicile ? score[0] : score[1];
  });
  const butsEncaisses = selection.map(match => {
    const score = extraireScore(match);
    return domicile ? score[1] : score[0];
  });

  return {
    equipe: nomEquipe,
    matchsAnalyses: selection.length,
    moyenneButsMarques: calculerMoyenne(butsMarques),
    moyenneButsEncaisses: calculerMoyenne(butsEncaisses)
  };
}

function calculerProbabilites(matchs, equipeDomicile, equipeExterieure, options = {}) {
  const opts = typeof options === "string" ? { dateReference: options } : (options || {});
  const dateReference = dateValide(opts.dateReference)
    ? opts.dateReference
    : new Date().toISOString().slice(0, 10);
  const competitionDemandee = normaliserCompetition(opts.competition);
  const matchsValides = (Array.isArray(matchs) ? matchs : [])
    .filter(match => {
      const score = extraireScore(match);
      if (
        !score ||
        !dateValide(match.date) ||
        match.date >= dateReference ||
        !match.domicile ||
        !match.exterieur ||
        normaliserNomEquipe(match.domicile) === normaliserNomEquipe(match.exterieur)
      ) return false;

      if (!competitionDemandee) return true;
      const competitionMatch = normaliserCompetition(match.championnat || match.competition || "");
      return !competitionMatch || competitionMatch === competitionDemandee;
    });

  if (matchsValides.length < 20) {
    return {
      success: false,
      message: "Données historiques insuffisantes pour produire une estimation prudente."
    };
  }

  const dateReferenceMs = Date.parse(dateReference + "T00:00:00Z");
  const attenuation = Math.log(2) / DEMI_VIE_JOURS;
  const equipeStats = new Map();
  let poidsTotal = 0;
  let butsDomicilePonderes = 0;
  let butsExterieurPonderes = 0;
  let dernierResultat = "";

  for (const match of matchsValides) {
    const score = extraireScore(match);
    const ageJours = Math.max(0, (dateReferenceMs - Date.parse(match.date + "T00:00:00Z")) / 86400000);
    const poids = Math.exp(-attenuation * ageJours);
    poidsTotal += poids;
    butsDomicilePonderes += poids * score[0];
    butsExterieurPonderes += poids * score[1];
    if (!dernierResultat || match.date > dernierResultat) dernierResultat = match.date;

    for (const [nom, role, butsMarques, butsEncaisses] of [
      [match.domicile, "domicile", score[0], score[1]],
      [match.exterieur, "exterieur", score[1], score[0]]
    ]) {
      const cle = normaliserNomEquipe(nom);
      if (!equipeStats.has(cle)) {
        equipeStats.set(cle, {
          domicile: { matchs: 0, poids: 0, poidsCarres: 0, marques: 0, encaisses: 0 },
          exterieur: { matchs: 0, poids: 0, poidsCarres: 0, marques: 0, encaisses: 0 }
        });
      }
      const stats = equipeStats.get(cle)[role];
      stats.matchs += 1;
      stats.poids += poids;
      stats.poidsCarres += poids * poids;
      stats.marques += poids * butsMarques;
      stats.encaisses += poids * butsEncaisses;
    }
  }

  const moyenneLigueDomicile = butsDomicilePonderes / poidsTotal;
  const moyenneLigueExterieur = butsExterieurPonderes / poidsTotal;
  const statsDomicile = equipeStats.get(normaliserNomEquipe(equipeDomicile))?.domicile;
  const statsExterieure = equipeStats.get(normaliserNomEquipe(equipeExterieure))?.exterieur;

  if (!statsDomicile || !statsExterieure || statsDomicile.matchs === 0 || statsExterieure.matchs === 0) {
    return {
      success: false,
      message: "Historique insuffisant pour une ou plusieurs équipes dans cette compétition."
    };
  }

  function tauxLisse(totalPondere, poids, moyenneLigue) {
    return (totalPondere + MATCHS_PRIOR * moyenneLigue) / (poids + MATCHS_PRIOR);
  }

  const attaqueDomicile = tauxLisse(statsDomicile.marques, statsDomicile.poids, moyenneLigueDomicile) / moyenneLigueDomicile;
  const defenseDomicile = tauxLisse(statsDomicile.encaisses, statsDomicile.poids, moyenneLigueExterieur) / moyenneLigueExterieur;
  const attaqueExterieure = tauxLisse(statsExterieure.marques, statsExterieure.poids, moyenneLigueExterieur) / moyenneLigueExterieur;
  const defenseExterieure = tauxLisse(statsExterieure.encaisses, statsExterieure.poids, moyenneLigueDomicile) / moyenneLigueDomicile;

  const butsAttendusDomicile = Math.min(4.5, Math.max(0.15, moyenneLigueDomicile * attaqueDomicile * defenseExterieure));
  const butsAttendusExterieur = Math.min(4.5, Math.max(0.15, moyenneLigueExterieur * attaqueExterieure * defenseDomicile));

  const distributionDomicile = Array.from(
    { length: MAX_BUTS_CALCUL + 1 },
    (_, buts) => valeurPoisson(butsAttendusDomicile, buts)
  );
  const distributionExterieure = Array.from(
    { length: MAX_BUTS_CALCUL + 1 },
    (_, buts) => valeurPoisson(butsAttendusExterieur, buts)
  );

  let victoireDomicile = 0;
  let matchNul = 0;
  let victoireExterieure = 0;
  let plusDe15 = 0;
  let plusDe25 = 0;
  let deuxEquipesMarquent = 0;
  let meilleurScore = { domicile: 0, exterieur: 0, probabilite: -1 };

  for (let butsH = 0; butsH <= MAX_BUTS_CALCUL; butsH++) {
    for (let butsA = 0; butsA <= MAX_BUTS_CALCUL; butsA++) {
      const probabilite = distributionDomicile[butsH] * distributionExterieure[butsA];
      if (butsH > butsA) victoireDomicile += probabilite;
      else if (butsH === butsA) matchNul += probabilite;
      else victoireExterieure += probabilite;
      if (butsH + butsA >= 2) plusDe15 += probabilite;
      if (butsH + butsA >= 3) plusDe25 += probabilite;
      if (butsH >= 1 && butsA >= 1) deuxEquipesMarquent += probabilite;
      if (probabilite > meilleurScore.probabilite) {
        meilleurScore = { domicile: butsH, exterieur: butsA, probabilite };
      }
    }
  }

  const somme = victoireDomicile + matchNul + victoireExterieure;
  const pourcentages = arrondirProbabilites([
    victoireDomicile / somme,
    matchNul / somme,
    victoireExterieure / somme
  ]);
  const probabilites = {
    victoireDomicile: pourcentages[0],
    matchNul: pourcentages[1],
    victoireExterieure: pourcentages[2]
  };
  const derniereDateMs = Date.parse(dernierResultat + "T00:00:00Z");
  const ageDernierResultat = Math.max(0, Math.floor((dateReferenceMs - derniereDateMs) / 86400000));
  const effectifDomicile = statsDomicile.poidsCarres > 0
    ? statsDomicile.poids * statsDomicile.poids / statsDomicile.poidsCarres
    : 0;
  const effectifExterieur = statsExterieure.poidsCarres > 0
    ? statsExterieure.poids * statsExterieure.poids / statsExterieure.poidsCarres
    : 0;
  const couverture = ageDernierResultat > 30 || Math.min(effectifDomicile, effectifExterieur) < 4
    ? "limitée"
    : ageDernierResultat > 14 || Math.min(effectifDomicile, effectifExterieur) < 7
      ? "moyenne"
      : "correcte";

  const moyennes = {
    butsMarquesDomicile: statsDomicile.marques / statsDomicile.poids,
    butsEncaissesDomicile: statsDomicile.encaisses / statsDomicile.poids,
    butsMarquesExterieur: statsExterieure.marques / statsExterieure.poids,
    butsEncaissesExterieur: statsExterieure.encaisses / statsExterieure.poids
  };

  return {
    success: true,
    source: "Résultats de la compétition, pondérés par récence",
    methode: "Poisson indépendant avec avantage domicile et lissage vers la moyenne de la ligue",
    equipeDomicile,
    equipeExterieure,
    competition: opts.competition || null,
    dateReference,
    matchsDomicileAnalyses: statsDomicile.matchs,
    matchsExterieurAnalyses: statsExterieure.matchs,
    historique: {
      matchsUtilises: matchsValides.length,
      dernierResultat,
      joursDepuisDernierResultat: ageDernierResultat,
      couvertureDonnees: couverture,
      effectifPondereDomicile: Number(effectifDomicile.toFixed(1)),
      effectifPondereExterieur: Number(effectifExterieur.toFixed(1)),
      demiVieJours: DEMI_VIE_JOURS
    },
    moyennes,
    butsAttendus: {
      domicile: Number(butsAttendusDomicile.toFixed(3)),
      exterieur: Number(butsAttendusExterieur.toFixed(3))
    },
    scoreLePlusProbable: {
      domicile: meilleurScore.domicile,
      exterieur: meilleurScore.exterieur,
      probabilite: Number((meilleurScore.probabilite * 100).toFixed(1))
    },
    probabilites,
    probabilitesButs: {
      plusDe15: Math.round(plusDe15 * 100),
      plusDe25: Math.round(plusDe25 * 100),
      deuxEquipesMarquent: Math.round(deuxEquipesMarquent * 100)
    },
    avertissement: "Estimation expérimentale issue des résultats historiques disponibles ; ce n'est ni une certitude ni un conseil de pari."
  };
}

module.exports = {
  calculerMoyenne,
  analyserEquipe,
  calculerProbabilites,
  normaliserNomEquipe,
  normaliserCompetition
};
