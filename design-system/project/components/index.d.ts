import type * as React from 'react';

export type IconName = 'note' | 'folder' | 'comb' | 'wikilink' | 'backlinks' | 'search' | 'tag' | 'daily' | 'task' | 'new-note' | 'settings' | 'command' | 'highlight' | 'pin' | 'chevron' | 'external' | 'close' | 'info' | 'warning';

export interface LogoProps { size?: number; wordmark?: boolean; className?: string }
export declare function Logo(props: LogoProps): React.ReactElement;

export interface IconProps { name: IconName; size?: number; label?: string; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; size?: 'sm' | 'md'; icon?: IconName }
export declare function Button(props: ButtonProps): React.ReactElement;

export interface KbdProps { children?: React.ReactNode; className?: string }
export declare function Kbd(props: KbdProps): React.ReactElement;

export interface TagProps { children?: React.ReactNode; count?: number; active?: boolean; tone?: 'honey' | 'stone'; href?: string; onClick?: (e: React.MouseEvent) => void; className?: string }
export declare function Tag(props: TagProps): React.ReactElement;

export interface TaskProps { checked?: boolean; defaultChecked?: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; children?: React.ReactNode; className?: string }
export declare function Task(props: TaskProps): React.ReactElement;

export interface WikilinkProps { children?: React.ReactNode; href?: string; onClick?: (e: React.MouseEvent) => void; unresolved?: boolean; external?: boolean; className?: string }
export declare function Wikilink(props: WikilinkProps): React.ReactElement;

export interface CalloutProps { kind?: 'note' | 'tip' | 'info' | 'warning'; title?: React.ReactNode; children?: React.ReactNode; className?: string }
export declare function Callout(props: CalloutProps): React.ReactElement;

export interface HexAvatarProps { name: string; label?: string; size?: number; tone?: 'honey' | 'stone' | 'wax'; className?: string }
export declare function HexAvatar(props: HexAvatarProps): React.ReactElement;

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> { shortcut?: string | null }
export declare function SearchField(props: SearchFieldProps): React.ReactElement;

export interface TreeItemProps { kind?: 'note' | 'folder'; label: React.ReactNode; depth?: number; open?: boolean; active?: boolean; count?: number; icon?: IconName; onClick?: (e: React.MouseEvent) => void; className?: string }
export declare function TreeItem(props: TreeItemProps): React.ReactElement;

export interface TabItem { id: string; title: string; pinned?: boolean; dirty?: boolean }
export interface TabsProps { tabs: TabItem[]; active?: string; onSelect?: (id: string) => void; className?: string }
export declare function Tabs(props: TabsProps): React.ReactElement;

export interface PaletteItem { icon?: IconName; label: string; hint?: string; shortcut?: string }
export interface CommandPaletteProps { query?: string; onQueryChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string; items: PaletteItem[]; activeIndex?: number; className?: string }
export declare function CommandPalette(props: CommandPaletteProps): React.ReactElement;

export interface CombCell { q: number; r: number; label?: string; title?: string; weight?: 0 | 1 | 2 | 3; active?: boolean; onClick?: () => void }
export interface CombProps { cells: CombCell[]; cellSize?: number; label?: string; className?: string }
export declare function Comb(props: CombProps): React.ReactElement;

declare global {
  interface Window {
    Basalt: { Logo: typeof Logo; Icon: typeof Icon; Button: typeof Button; Kbd: typeof Kbd; Tag: typeof Tag; Task: typeof Task; Wikilink: typeof Wikilink; Callout: typeof Callout; HexAvatar: typeof HexAvatar; SearchField: typeof SearchField; TreeItem: typeof TreeItem; Tabs: typeof Tabs; CommandPalette: typeof CommandPalette; Comb: typeof Comb };
  }
}
