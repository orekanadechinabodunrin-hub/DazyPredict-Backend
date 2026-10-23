
const fs = require("fs");
const path = require("path");

const fichiersSaisons = [
  "matchs_historiques.json",
  "matchs_2026_2027.json"
];

function chargerMatchsHistoriques() {
  const matchsParCle = new Map();

  for (const fichier of fichiersSaisons) {
    const chemin = path.join(__dirname, fichier);

    if (!fs.existsSync(chemin)) {
      console.warn(`Fichier ignoré : ${fichier} introuvable.`);
      continue;
    }

    let donnees;

    try {
      donnees = JSON.parse(fs.readFileSync(chemin, "utf8"));
    } catch (error) {
      console.warn(`Fichier JSON ignoré : ${fichier}`, error.message);
      continue;
    }

    if (!Array.isArray(donnees.matches)) {
      console.warn(`Fichier ignoré : ${fichier} ne contient pas de matchs.`);
      continue;
    }

    for (const match of donnees.matches) {
      if (
        !match ||
        typeof match.team1 !== "string" ||
        typeof match.team2 !== "string" ||
        typeof match.date !== "string" ||
        !Array.isArray(match.score?.ft) ||
        match.score.ft.length !== 2 ||
        !Number.isFinite(match.score.ft[0]) ||
        !Number.isFinite(match.score.ft[1])
      ) {
        continue;
      }

      const resultat = {
        date: match.date,
        domicile: match.team1,
        exterieur: match.team2,
        butsDomicile: match.score.ft[0],
        butsExterieur: match.score.ft[1]
      };

      const cle = [
        resultat.date,
        resultat.domicile,
        resultat.exterieur
      ].join("|");

      // En cas de doublon, conserver le résultat du fichier le plus récent.
      matchsParCle.set(cle, resultat);
    }
  }

  return [...matchsParCle.values()]
    .sort((a, b) => b.date.localeCompare(a.date));
}

module.exports = { chargerMatchsHistoriques };
