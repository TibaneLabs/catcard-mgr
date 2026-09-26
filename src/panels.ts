/** Lets one part of the page open a firmware panel and bring it into view. */
import { ref } from 'vue';

export type PanelName = 'coldcard-update' | 'catcard-switch';

/** The latest request; `n` changes on every request, so asking twice still fires. */
export const panelRequest = ref<{ name: PanelName; n: number } | null>(null);

export function openPanel(name: PanelName): void {
  panelRequest.value = { name, n: (panelRequest.value?.n ?? 0) + 1 };
}
