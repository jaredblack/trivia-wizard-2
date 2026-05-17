function randomQuestionId(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let id = "";
  for (let i = 0; i < 3; i++) {
    id += letters[Math.floor(Math.random() * letters.length)];
  }
  return id;
}

export function scaffoldYaml(): string {
  return `title: Untitled
subtitle: ''
slides:
  - type: image
    title: |
      One person from each team:
      Join the game on Trivia Wizard
      Game code: TODO
    image: trivia-wizard-join-qr
  - type: category
    title: First Category
  - type: question
    id: ${randomQuestionId()}
    question: Sample question?
    answer: Sample answer
`;
}
