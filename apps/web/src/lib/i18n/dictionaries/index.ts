import { en } from "./en";
import { he } from "./he";
import type { Dictionary } from "./dictionary-type";
import type { Locale } from "../locale";

export type { Dictionary } from "./dictionary-type";
export const DICTIONARIES: Record<Locale, Dictionary> = { en, he };
