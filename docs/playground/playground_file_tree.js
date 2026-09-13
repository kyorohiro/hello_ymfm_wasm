export function buildFileTree(files) {
  const root = { children: new Map() };
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let parent = root;
    parts.forEach((name, index) => {
      const path = `/${parts.slice(0, index + 1).join('/')}`;
      if (!parent.children.has(name)) {
        parent.children.set(name, { name, path, children: new Map() });
      }
      parent = parent.children.get(name);
      if (index === parts.length - 1) parent.file = file;
    });
  }
  function sorted(node) {
    return [...node.children.values()].sort((a, b) =>
      Number(b.children.size > 0) - Number(a.children.size > 0) ||
      a.name.localeCompare(b.name, undefined, { numeric: true })
    ).map(child => ({ ...child, children: sorted(child) }));
  }
  return sorted(root);
}

export function renderFileTree(root, files, { selectedPath, expanded, onOpen }) {
  function render(nodes) {
    const list = document.createElement('ul');
    list.className = 'file-tree';
    for (const node of nodes) {
      const item = document.createElement('li');
      if (node.children.length) {
        const folder = document.createElement('details');
        folder.open = expanded.get(node.path) ?? selectedPath?.startsWith(`${node.path}/`) ?? false;
        const label = document.createElement('summary');
        label.textContent = node.name;
        label.title = node.path;
        folder.append(label, render(node.children));
        folder.addEventListener('toggle', () => expanded.set(node.path, folder.open));
        item.appendChild(folder);
      }
      if (node.file) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'file-entry';
        button.textContent = node.name;
        button.title = node.path;
        button.setAttribute('aria-current', String(node.path === selectedPath));
        button.addEventListener('click', () => { button.blur(); onOpen(node.path); });
        item.appendChild(button);
      }
      list.appendChild(item);
    }
    return list;
  }
  root.replaceChildren(render(buildFileTree(files)));
}
