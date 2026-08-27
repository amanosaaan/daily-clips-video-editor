import {
  alignPatches,
  bringToFrontPatches,
  rotatePatches,
  sendToBackPatches,
  stepZIndexPatches,
  type LayerPatch,
} from '../domain/arrange';
import type { Layer, Project, Scene } from '../domain/types';
import { useProjectStore } from '../state/projectStore';
import {
  AlignBottomIcon,
  AlignCenterHIcon,
  AlignLeftIcon,
  AlignMiddleIcon,
  AlignRightIcon,
  AlignTopIcon,
  BringToFrontIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DistributeIcon,
  FocusIcon,
  GroupIcon,
  LayersIcon,
  RotateLeftIcon,
  RotateRightIcon,
  SendToBackIcon,
  UngroupIcon,
} from './icons';
import { MenubarMenu, type MenubarMenuItem } from './MenubarMenu';

interface Props {
  project: Project;
  scene: Scene;
  layers: Layer[];
}

export function ArrangeMenu({ project, scene, layers }: Props) {
  const updateLayer = useProjectStore((s) => s.updateLayer);

  function apply(results: LayerPatch[]) {
    results.forEach(({ id, patch }) => updateLayer(scene.id, id, patch));
  }

  function step(direction: 'forward' | 'backward') {
    if (layers.length !== 1) return;
    const result = stepZIndexPatches(scene.layers, layers[0], direction);
    if (!result) return;
    updateLayer(scene.id, layers[0].id, result.targetPatch);
    updateLayer(scene.id, result.neighborId, result.neighborPatch);
  }

  const disabled = layers.length === 0;
  const singleOnly = layers.length !== 1;

  const items: MenubarMenuItem[] = [
    {
      label: '順序',
      icon: LayersIcon,
      disabled,
      items: [
        { label: '最前面に移動', icon: BringToFrontIcon, disabled, onClick: () => apply(bringToFrontPatches(scene.layers, layers)) },
        { label: '前面へ移動', icon: ChevronUpIcon, disabled: disabled || singleOnly, onClick: () => step('forward') },
        { label: '背面へ移動', icon: ChevronDownIcon, disabled: disabled || singleOnly, onClick: () => step('backward') },
        { label: '最背面に移動', icon: SendToBackIcon, disabled, onClick: () => apply(sendToBackPatches(scene.layers, layers)) },
      ],
    },
    {
      label: '配置',
      icon: AlignCenterHIcon,
      disabled,
      items: [
        { label: '左', icon: AlignLeftIcon, disabled, onClick: () => apply(alignPatches(project, layers, 'left')) },
        { label: '中央', icon: AlignCenterHIcon, disabled, onClick: () => apply(alignPatches(project, layers, 'centerH')) },
        { label: '右', icon: AlignRightIcon, disabled, onClick: () => apply(alignPatches(project, layers, 'right')) },
        { label: '上', icon: AlignTopIcon, disabled, onClick: () => apply(alignPatches(project, layers, 'top')) },
        { label: '中央（縦）', icon: AlignMiddleIcon, disabled, onClick: () => apply(alignPatches(project, layers, 'centerV')) },
        { label: '下', icon: AlignBottomIcon, disabled, onClick: () => apply(alignPatches(project, layers, 'bottom')) },
      ],
    },
    { label: '整列', icon: DistributeIcon, disabled: true },
    {
      label: 'シーンの中央',
      icon: FocusIcon,
      disabled,
      onClick: () => {
        apply(alignPatches(project, layers, 'centerH'));
        apply(alignPatches(project, layers, 'centerV'));
      },
    },
    {
      label: '回転',
      icon: RotateRightIcon,
      disabled,
      items: [
        { label: '反時計回りに回転', icon: RotateLeftIcon, disabled, onClick: () => apply(rotatePatches(layers, -90)) },
        { label: '時計回りに回転', icon: RotateRightIcon, disabled, onClick: () => apply(rotatePatches(layers, 90)) },
      ],
    },
    { label: '', divider: true },
    { label: 'グループ化', icon: GroupIcon, disabled: true, shortcut: 'Ctrl+Alt+G' },
    { label: 'グループ化解除', icon: UngroupIcon, disabled: true, shortcut: 'Ctrl+Alt+Shift+G' },
  ];

  return <MenubarMenu label="配置" items={items} />;
}
