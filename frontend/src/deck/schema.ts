// JSON Schema for the deck format, built from the settings table so hover docs
// and defaults always match what the compiler actually does.

import { SETTINGS, formatSetting, type SettingDef } from "./settings";

type Json = Record<string, unknown>;

function settingSchema(def: SettingDef): Json {
  const where = def.kinds ? ` Applies to ${def.kinds.join(", ")} questions.` : "";
  const description = `${def.description}${where} Default: ${formatSetting(
    def.key,
    def.builtin
  )}.`;
  const t = def.value;
  switch (t.type) {
    case "enum":
      return { enum: t.values, description };
    case "integer":
      return { type: "integer", minimum: t.min, description };
    case "number":
      return { type: "number", minimum: t.min, description };
    case "boolean":
      return { type: "boolean", description };
    case "range":
      return {
        oneOf: [
          { type: "number", minimum: 0 },
          { type: "string", pattern: "^\\d+(\\.\\d+)?%$" },
        ],
        description,
      };
  }
}

const settingProps: Json = Object.fromEntries(
  SETTINGS.map((def) => [def.key, settingSchema(def)])
);

const imageNames =
  "An image name (uploaded to this event, or a shared image) or a full web address.";

const images = (when: string): Json => ({
  description: `${when} ${imageNames} Paste or drop an image in the editor to upload it and fill this in.`,
  oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
});

const notes: Json = {
  type: "string",
  description: "Speaker notes. Never shown to the audience.",
};

const contentProps: Json = {
  a: {
    description:
      "The answer, revealed on the slide and used for scoring. A list replaces the choices on reveal (ranking questions).",
    oneOf: [
      { type: "string" },
      { type: "number" },
      { type: "array", items: { type: ["string", "number"] } },
    ],
  },
  choices: {
    type: "array",
    items: { type: ["string", "number"] },
    description:
      "Options shown as A, B, C… A question with choices is multiple-choice unless `kind` says otherwise.",
  },
  matching: {
    type: "object",
    description: "Two columns to match: numbered on the left, lettered on the right.",
    required: ["left", "right"],
    additionalProperties: false,
    properties: {
      left: { type: "array", items: { type: ["string", "number"] } },
      right: { type: "array", items: { type: ["string", "number"] } },
    },
  },
  image: images("Shown with the question."),
  "answer-image": images("Shown when the answer is revealed."),
  notes,
};

export function buildDeckSchema(): Json {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Trivia deck",
    type: "object",
    required: ["title", "slides"],
    additionalProperties: false,
    properties: {
      title: { type: "string", description: "Shown on the opening title slide." },
      subtitle: {
        type: ["string", "number"],
        description: "Smaller line under the title.",
      },
      defaults: {
        type: "object",
        description:
          "Settings for every question in the deck. A category overrides these for its questions, and a question overrides both.",
        additionalProperties: false,
        properties: settingProps,
      },
      slides: {
        type: "array",
        description:
          "The slides, in order. Each starts with `q:`, `then:`, `category:`, `image:`, `html:`/`file:`, or is the word `join`.",
        items: {
          oneOf: [
            {
              const: "join",
              description:
                "The join slide: shows the live game code and the join QR code.",
            },
            { $ref: "#/definitions/question" },
            { $ref: "#/definitions/then" },
            { $ref: "#/definitions/category" },
            { $ref: "#/definitions/imageSlide" },
            { $ref: "#/definitions/custom" },
          ],
        },
      },
    },
    definitions: {
      question: {
        type: "object",
        title: "Question",
        required: ["q"],
        additionalProperties: false,
        properties: {
          q: {
            type: ["string", "number"],
            description:
              "The question text. Starts a new numbered question; any setting below overrides the category and deck defaults for this question only.",
          },
          ...contentProps,
          location: {
            type: "array",
            items: { type: "number" },
            minItems: 2,
            maxItems: 2,
            description: "Map questions: the correct spot as [latitude, longitude].",
          },
          ...settingProps,
        },
      },
      then: {
        type: "object",
        title: "Follow-up slide",
        required: ["then"],
        additionalProperties: false,
        properties: {
          then: {
            type: ["string", "number"],
            description:
              "Text for an extra slide belonging to the question above. Keeps the same question number.",
          },
          ...contentProps,
        },
      },
      category: {
        type: "object",
        title: "Category",
        required: ["category"],
        additionalProperties: false,
        properties: {
          category: {
            type: ["string", "number"],
            description:
              "Category title slide. Settings declared here apply to every question until the next category.",
          },
          subtitle: {
            type: ["string", "number"],
            description: "Smaller line under the category title.",
          },
          image: images("Shown under the category title."),
          notes,
          ...settingProps,
        },
      },
      imageSlide: {
        type: "object",
        title: "Image slide",
        required: ["image"],
        additionalProperties: false,
        properties: {
          image: { type: "string", description: `A slide with one large image. ${imageNames}` },
          title: { type: "string", description: "Heading above the image." },
          notes,
        },
      },
      custom: {
        type: "object",
        title: "Custom slide",
        anyOf: [{ required: ["html"] }, { required: ["file"] }],
        additionalProperties: false,
        properties: {
          html: { type: "string", description: "Raw HTML for the slide." },
          file: {
            type: "string",
            description: "Path to an HTML file in this event's folder or the shared one.",
          },
          notes,
        },
      },
    },
  };
}
