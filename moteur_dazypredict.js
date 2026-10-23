
/**
 * DAZYPREDICT — MOTEUR AUTONOME
 * Version 1 : calculs à partir de résultats historiques.
 * Aucun appel à API-Football.
 */

function calculerMoyenne(valeurs) {
  if (!Array.isArray(valeurs) || valeurs.length === 0) {
    return 0;
  }

  return valeurs.reduce((total, valeur) => {
    return total + Number(valeur || 0);
  }, 0) / valeurs.length;
}
function normaliserNomEquipe(nom) {
  return String(nom || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|ac|as|fk|sk)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}
function analyserEquipe(matchs, nomEquipe, domicile = true) {
  if (!Array.isArray(matchs)) {
    throw new Error("La liste des matchs doit être un tableau.");
  }

  const joues = matchs
    .filter((match) => {
      const equipe = domicile ? match.domicile : match.exterieur;

      return normaliserNomEquipe(equipe) === normaliserNomEquipe(nomEquipe) &&
        Number.isFinite(Number(match.butsDomicile)) &&
        Number.isFinite(Number(match.butsExterieur)) &&
        typeof match.date === "string";
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  const butsMarques = joues.map((match) => {
    return domicile
      ? Number(match.butsDomicile)
      : Number(match.butsExterieur);
  });

  const butsEncaisses = joues.map((match) => {
    return domicile
      ? Number(match.butsExterieur)
      : Number(match.butsDomicile);
  });

  return {
    equipe: nomEquipe,
    matchsAnalyses: joues.length,
    moyenneButsMarques: calculerMoyenne(butsMarques),
    moyenneButsEncaisses: calculerMoyenne(butsEncaisses)
  };
}

function calculerProbabilites(matchs, equipeDomicile, equipeExterieure) {
  const domicile = analyserEquipe(matchs, equipeDomicile, true);
  const exterieur = analyserEquipe(matchs, equipeExterieure, false);

  if (domicile.matchsAnalyses === 0 || exterieur.matchsAnalyses === 0) {
    return {
      success: false,
      message: "Données historiques insuffisantes pour ces équipes."
    };
  }

  const forceDomicile =
    (domicile.moyenneButsMarques + exterieur.moyenneButsEncaisses) / 2;

  const forceExterieure =
    (exterieur.moyenneButsMarques + domicile.moyenneButsEncaisses) / 2;

  const total = forceDomicile + forceExterieure;

  if (total <= 0) {
    return {
      success: false,
      message: "Impossible de calculer les probabilités avec ces données."
    };
  }

  const probabiliteDomicile = forceDomicile / total;
  const probabiliteExterieure = forceExterieure / total;

  // Première estimation simplifiée, pas encore un modèle calibré.
  const probabiliteNul = Math.max(
    0.15,
    1 - Math.abs(probabiliteDomicile - probabiliteExterieure) - 0.55
  );

  const somme =
    probabiliteDomicile + probabiliteExterieure + probabiliteNul;

  return {
    success: true,
    source: "Résultats historiques fournis",
    equipeDomicile,
    equipeExterieure,
    matchsDomicileAnalyses: domicile.matchsAnalyses,
    matchsExterieurAnalyses: exterieur.matchsAnalyses,
    moyennes: {
      butsMarquesDomicile: domicile.moyenneButsMarques,
      butsEncaissesDomicile: domicile.moyenneButsEncaisses,
      butsMarquesExterieur: exterieur.moyenneButsMarques,
      butsEncaissesExterieur: exterieur.moyenneButsEncaisses
    },
    probabilites: {
      victoireDomicile: Math.round(
        (probabiliteDomicile / somme) * 100
      ),
      matchNul: Math.round((probabiliteNul / somme) * 100),
      victoireExterieure: Math.round(
        (probabiliteExterieure / somme) * 100
      )
    },
    avertissement:
      "Estimation expérimentale : elle ne garantit pas le résultat du match."
  };
}

module.exports = {
  calculerMoyenne,
  analyserEquipe,
  calculerProbabilites
};
