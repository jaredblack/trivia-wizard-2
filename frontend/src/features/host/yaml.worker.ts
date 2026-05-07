// Vite workaround documented in monaco-yaml README ("Why doesn't it work with
// Vite?"). Importing monaco-yaml/yaml.worker.js?worker directly fails with
// "Unexpected usage" inside Monaco's worker layer; wrapping the import in a
// project-local file and using *that* with ?worker resolves it.
import "monaco-yaml/yaml.worker.js";
