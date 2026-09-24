import { generateAriaTree, renderAriaTree } from './packages/injected/src/ariaSnapshot';
import { setGlobalOptions } from './packages/injected/src/domUtils';
export { getAriaRole, getElementAccessibleNameText, isElementHiddenForAria } from './packages/injected/src/roleUtils';

setGlobalOptions({ browserNameForWorkarounds: 'webkit' });

export function snapshot(root: Element): string {
  const options = { mode: 'default' as const };
  return renderAriaTree(generateAriaTree(root, options), options).text;
}
