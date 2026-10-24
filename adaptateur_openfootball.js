
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
    typeof match.date !== "string"
  ) {
    continue;
  }

  const scoreFinal = Array.isArray(match.score)
    ? match.score
    : match.score?.ft;

  if (
    !Array.isArray(scoreFinal) ||
    scoreFinal.length !== 2 ||
    !Number.isFinite(scoreFinal[0]) ||
    !Number.isFinite(scoreFinal[1])
  ) {
    continue;
  }


      
const resultat = {
  date: match.date,
  domicile: match.team1,
  exterieur: match.team2,
  butsDomicile: scoreFinal[0],
  butsExterieur: scoreFinal[1]
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


function chargerCalendrierOpenFootball() {
  const matchsParCle = new Map();

  for (const fichier of fichiersSaisons) {
    const chemin = path.join(__dirname, fichier);

    if (!fs.existsSync(chemin)) continue;

    try {
      const donnees = JSON.parse(fs.readFileSync(chemin, "utf8"));

      if (!Array.isArray(donnees.matches)) continue;

      for (const match of donnees.matches) {
        if (
          !match ||
          typeof match.team1 !== "string" ||
          typeof match.team2 !== "string" ||
          typeof match.date !== "string"
        ) {
          continue;
        }

        const scoreFinal = Array.isArray(match.score)
          ? match.score
          : match.score?.ft;

        const scoreValide =
          Array.isArray(scoreFinal) &&
          scoreFinal.length === 2 &&
          Number.isFinite(scoreFinal[0]) &&
          Number.isFinite(scoreFinal[1]);

        const resultat = {
          date: match.date,
          heure: match.time ?? null,
          domicile: match.team1,
          exterieur: match.team2,
          butsDomicile: scoreValide ? scoreFinal[0] : null,
          butsExterieur: scoreValide ? scoreFinal[1] : null,
          scoreDisponible: scoreValide,
          championnat: donnees.name ?? "Championnat non précisé"
        };

        const cle = [
          resultat.date,
          resultat.domicile,
          resultat.exterieur
        ].join("|");

        matchsParCle.set(cle, resultat);
      }
    } catch (error) {
      console.warn(`Fichier ignoré : ${fichier}`, error.message);
    }
  }

  return [...matchsParCle.values()]
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      (a.heure ?? "").localeCompare(b.heure ?? "")
    );
}

module.exports = {
  chargerMatchsHistoriques,
  chargerCalendrierOpenFootball
};

