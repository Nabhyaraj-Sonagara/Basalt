import './react-global';
import './generated/bundle.js';
import type { BasaltNamespace } from './basalt-types';

export type { IconName, TabItem, PaletteItem, CombCell, SelectOption } from './basalt-types';

const B = (window as unknown as { Basalt: BasaltNamespace }).Basalt;

export const {
  Logo, Icon, Button, Kbd, Tag, Task, Wikilink, Callout, HexAvatar, SearchField, TreeItem, Tabs,
  CommandPalette, Comb, EmptyState, HoverPreview, Toggle, Select, SettingsGroup, SettingRow, Toast, ToastStack,
} = B;
