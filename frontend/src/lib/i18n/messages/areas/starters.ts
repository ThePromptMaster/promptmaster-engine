/** The side chat's suggested questions (lib/workflow/chat-starters.ts), left in English until 24 Oct. */
export const en = {
  'starter.produce': 'What should the {stage} stage produce for this project?',
  'starter.openRows_one': 'Which of the {count} open row matters most, and why?',
  'starter.openRows_other': 'Which of the {count} open rows matter most, and why?',
  'starter.summarise': 'Summarise what still needs my decision here.',
  'starter.tableWrong': 'Is anything in this table missing or wrong?',
  'starter.outlineCovers': 'Does this outline cover everything the objective promises?',
  'starter.outlineWeakest': 'Which section is weakest or most out of place?',
  'starter.chapterWork': 'Which chapter needs the most work, and why?',
  'starter.chaptersContradict': 'Do the chapters contradict each other anywhere?',
  'starter.weakest': 'What is the weakest part of this draft?',
  'starter.objective': 'Does this still serve the objective?',
  'starter.stillNeeds': 'What does this stage still need from me? (Not yet: {criterion})',
  'starter.ready': 'Is this ready for {stage}?',
} as const;

type Keys = Record<keyof typeof en, string>;

export const es: Keys = {
  'starter.produce': '¿Qué debe producir la etapa {stage} en este proyecto?',
  'starter.openRows_one': '¿Cuál de las {count} filas abiertas importa más, y por qué?',
  'starter.openRows_other': '¿Cuáles de las {count} filas abiertas importan más, y por qué?',
  'starter.summarise': 'Resume lo que aún necesita mi decisión aquí.',
  'starter.tableWrong': '¿Falta algo en esta tabla o hay algo mal?',
  'starter.outlineCovers': '¿Cubre este esquema todo lo que promete el objetivo?',
  'starter.outlineWeakest': '¿Qué sección es la más débil o la que menos encaja?',
  'starter.chapterWork': '¿Qué capítulo necesita más trabajo, y por qué?',
  'starter.chaptersContradict': '¿Se contradicen los capítulos en algún punto?',
  'starter.weakest': '¿Cuál es la parte más débil de este borrador?',
  'starter.objective': '¿Sigue esto sirviendo al objetivo?',
  'starter.stillNeeds': '¿Qué necesita aún de mí esta etapa? (Pendiente: {criterion})',
  'starter.ready': '¿Está listo para {stage}?',
};

export const fr: Keys = {
  'starter.produce': 'Que doit produire l’étape {stage} pour ce projet ?',
  'starter.openRows_one': 'Laquelle des {count} lignes ouvertes compte le plus, et pourquoi ?',
  'starter.openRows_other': 'Lesquelles des {count} lignes ouvertes comptent le plus, et pourquoi ?',
  'starter.summarise': 'Résume ce qui attend encore ma décision ici.',
  'starter.tableWrong': 'Manque-t-il quelque chose dans ce tableau, ou y a-t-il une erreur ?',
  'starter.outlineCovers': 'Ce plan couvre-t-il tout ce que promet l’objectif ?',
  'starter.outlineWeakest': 'Quelle section est la plus faible ou la moins à sa place ?',
  'starter.chapterWork': 'Quel chapitre demande le plus de travail, et pourquoi ?',
  'starter.chaptersContradict': 'Les chapitres se contredisent-ils quelque part ?',
  'starter.weakest': 'Quelle est la partie la plus faible de ce brouillon ?',
  'starter.objective': 'Cela sert-il toujours l’objectif ?',
  'starter.stillNeeds': 'De quoi cette étape a-t-elle encore besoin de ma part ? (Pas encore : {criterion})',
  'starter.ready': 'Est-ce prêt pour {stage} ?',
};

export const pt: Keys = {
  'starter.produce': 'O que a etapa {stage} deve produzir neste projeto?',
  'starter.openRows_one': 'Qual das {count} linhas em aberto importa mais, e por quê?',
  'starter.openRows_other': 'Quais das {count} linhas em aberto importam mais, e por quê?',
  'starter.summarise': 'Resuma o que ainda precisa da minha decisão aqui.',
  'starter.tableWrong': 'Falta algo nesta tabela ou há algo errado?',
  'starter.outlineCovers': 'Este esboço cobre tudo o que o objetivo promete?',
  'starter.outlineWeakest': 'Qual seção é a mais fraca ou a mais fora de lugar?',
  'starter.chapterWork': 'Qual capítulo precisa de mais trabalho, e por quê?',
  'starter.chaptersContradict': 'Os capítulos se contradizem em algum ponto?',
  'starter.weakest': 'Qual é a parte mais fraca deste rascunho?',
  'starter.objective': 'Isto ainda serve ao objetivo?',
  'starter.stillNeeds': 'O que esta etapa ainda precisa de mim? (Ainda não: {criterion})',
  'starter.ready': 'Isto está pronto para {stage}?',
};
