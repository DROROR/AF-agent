import { Bot, Palette, Plug, User, type LucideIcon } from "lucide-react";

export type SettingsSectionId = "ai-providers" | "appearance" | "account" | "integrations";

export interface SettingsSection {
  id: SettingsSectionId;
  icon: LucideIcon;
}

/** Left-column vertical settings nav - every entry here backs a real, working section (no placeholder/unfinished tabs). See t.settings.nav* for labels. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "ai-providers", icon: Bot },
  { id: "appearance", icon: Palette },
  { id: "account", icon: User },
  { id: "integrations", icon: Plug }
];
