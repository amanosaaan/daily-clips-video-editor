import {
  AlignCenter,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowLeft,
  ArrowLeftRight,
  AudioLines,
  Bold,
  BringToFront,
  Calendar,
  Captions,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Copy,
  Crop,
  Expand,
  Focus,
  FolderOpen,
  Grid3x3,
  Group,
  ImageIcon as LucideImageIcon,
  Italic,
  Layers,
  Minus,
  MousePointer2,
  MousePointerSquareDashed,
  Palette,
  Pause,
  Pen,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Scissors,
  Search,
  SendToBack,
  Shapes,
  Slash,
  Square,
  Trash2,
  Type,
  Underline,
  Undo2,
  Redo2,
  Ungroup,
  Upload,
  Video,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react';

function icon(Lucide: LucideIcon) {
  return function WrappedIcon({ size = 18 }: { size?: number }) {
    return <Lucide size={size} strokeWidth={1.8} aria-hidden="true" />;
  };
}

export const UploadIcon = icon(Upload);
export const ShapeIcon = icon(Shapes);
export const TextIcon = icon(Type);
export const CaptionIcon = icon(Captions);
export const PlusIcon = icon(Plus);
export const CloseIcon = icon(X);
export const BackIcon = icon(ArrowLeft);
export const PlayIcon = icon(Play);
export const PauseIcon = icon(Pause);
export const TrashIcon = icon(Trash2);
export const UndoIcon = icon(Undo2);
export const RedoIcon = icon(Redo2);
export const SearchIcon = icon(Search);
export const CursorIcon = icon(MousePointer2);
export const FrameIcon = icon(Square);
export const PaletteIcon = icon(Palette);
export const PenIcon = icon(Pen);
export const BringToFrontIcon = icon(BringToFront);
export const SendToBackIcon = icon(SendToBack);
export const AlignLeftIcon = icon(AlignHorizontalJustifyStart);
export const AlignCenterHIcon = icon(AlignHorizontalJustifyCenter);
export const AlignRightIcon = icon(AlignHorizontalJustifyEnd);
export const AlignTopIcon = icon(AlignVerticalJustifyStart);
export const AlignMiddleIcon = icon(AlignVerticalJustifyCenter);
export const AlignBottomIcon = icon(AlignVerticalJustifyEnd);
export const RotateLeftIcon = icon(RotateCcw);
export const RotateRightIcon = icon(RotateCw);
export const LayersIcon = icon(Layers);
export const GroupIcon = icon(Group);
export const UngroupIcon = icon(Ungroup);
export const FocusIcon = icon(Focus);
export const FolderOpenIcon = icon(FolderOpen);
export const DistributeIcon = icon(AlignHorizontalDistributeCenter);
export const ChevronUpIcon = icon(ChevronUp);
export const ChevronDownIcon = icon(ChevronDown);
export const ChevronLeftIcon = icon(ChevronLeft);
export const ChevronRightIcon = icon(ChevronRight);
export const MinusIcon = icon(Minus);
export const TextAlignLeftIcon = icon(AlignLeft);
export const TextAlignCenterIcon = icon(AlignCenter);
export const TextAlignRightIcon = icon(AlignRight);
export const ImageIcon = icon(LucideImageIcon);
export const CropIcon = icon(Crop);
export const ExpandIcon = icon(Expand);
export const BoldIcon = icon(Bold);
export const ItalicIcon = icon(Italic);
export const UnderlineIcon = icon(Underline);
export const ShapeRectIcon = icon(Square);
export const ShapeCircleIcon = icon(Circle);
export const ShapeLineIcon = icon(Slash);
export const MuteOnIcon = icon(VolumeX);
export const MuteOffIcon = icon(Volume2);
export const MultiSelectIcon = icon(MousePointerSquareDashed);
export const CopyIcon = icon(Copy);
export const ScissorsIcon = icon(Scissors);
export const SwapIcon = icon(ArrowLeftRight);
export const VideoIcon = icon(Video);
export const AudioIcon = icon(AudioLines);
export const CalendarIcon = icon(Calendar);
export const MosaicIcon = icon(Grid3x3);
