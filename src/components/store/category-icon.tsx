import { BookOpen } from 'phosphor-react-native/src/icons/BookOpen';
import { Camera } from 'phosphor-react-native/src/icons/Camera';
import { ChatCircle } from 'phosphor-react-native/src/icons/ChatCircle';
import { CheckSquare } from 'phosphor-react-native/src/icons/CheckSquare';
import { CloudSun } from 'phosphor-react-native/src/icons/CloudSun';
import { Code } from 'phosphor-react-native/src/icons/Code';
import { FilmStrip } from 'phosphor-react-native/src/icons/FilmStrip';
import { FolderOpen } from 'phosphor-react-native/src/icons/FolderOpen';
import { GameController } from 'phosphor-react-native/src/icons/GameController';
import { GraduationCap } from 'phosphor-react-native/src/icons/GraduationCap';
import { Heartbeat } from 'phosphor-react-native/src/icons/Heartbeat';
import { MapTrifold } from 'phosphor-react-native/src/icons/MapTrifold';
import { MusicNotes } from 'phosphor-react-native/src/icons/MusicNotes';
import { Newspaper } from 'phosphor-react-native/src/icons/Newspaper';
import { PaintBrush } from 'phosphor-react-native/src/icons/PaintBrush';
import { ShieldCheck } from 'phosphor-react-native/src/icons/ShieldCheck';
import { SquaresFour } from 'phosphor-react-native/src/icons/SquaresFour';
import { UsersThree } from 'phosphor-react-native/src/icons/UsersThree';
import { Wallet } from 'phosphor-react-native/src/icons/Wallet';
import { Wrench } from 'phosphor-react-native/src/icons/Wrench';
import type { Icon } from 'phosphor-react-native';

import { useColors } from '@/theme';

// Icon names come from public.categories.icon.
const ICONS: Record<string, Icon> = {
  'check-square': CheckSquare,
  wrench: Wrench,
  'chat-circle': ChatCircle,
  'users-three': UsersThree,
  'music-notes': MusicNotes,
  'film-strip': FilmStrip,
  camera: Camera,
  'shield-check': ShieldCheck,
  'paint-brush': PaintBrush,
  'book-open': BookOpen,
  newspaper: Newspaper,
  'map-trifold': MapTrifold,
  heartbeat: Heartbeat,
  wallet: Wallet,
  'graduation-cap': GraduationCap,
  'cloud-sun': CloudSun,
  'folder-open': FolderOpen,
  code: Code,
  'game-controller': GameController,
};

export function CategoryIcon({ name, size = 20, color }: { name: string | undefined; size?: number; color?: string }) {
  const c = useColors();
  const Glyph = (name && ICONS[name]) || SquaresFour;
  return <Glyph size={size} color={color ?? c.text} weight="light" />;
}
