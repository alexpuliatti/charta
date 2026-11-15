const paths = {
  rename: 'M4 20h4L20 8l-4-4L4 16v4Zm10-14 4 4M3 22h18',
  edit: 'm15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z',
  connect: 'M5 6h14v14H5zM8 3h14v14',
  external: 'M8 5H4v15h15v-4M12 4h8v8m0-8L10 14',
  remove: 'M5 12h14',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
};
const actions = { 'rename-item': 'rename', 'edit-block': 'edit', 'edit-collection': 'edit', 'connect-block': 'connect', 'remove-item': 'remove', 'delete-item': 'trash' };

export function menuIcon(document, item) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  svg.classList.add('menu-icon');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[item.icon || actions[item.data?.action] || (item.href ? 'external' : 'edit')] || paths.edit);
  svg.append(path);
  return svg;
}
