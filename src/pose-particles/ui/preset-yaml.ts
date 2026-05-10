import * as YAML from "yaml";
import type { Settings } from "../settings";

export function serializePresetYaml(settings: Settings): string {
  return YAML.stringify(settings);
}

export function parsePresetYaml(text: string): Partial<Settings> {
  return YAML.parse(text) as Partial<Settings>;
}
