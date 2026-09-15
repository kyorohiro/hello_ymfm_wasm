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

export function renderFileTree(root, files, { selectedPath, expanded, onOpen, onTransfer, onImport }) {
  const dragType = 'application/x-tetorica-path';
  function draggable(element, path) {
    if (!onTransfer) return;
    element.draggable = true;
    element.addEventListener('dragstart', event => {
      event.stopPropagation();
      event.dataTransfer.setData(dragType, path);
      event.dataTransfer.effectAllowed = 'copyMove';
    });
  }
  function dropTarget(element, directory) {
    if (!onTransfer && !onImport) return;
    element.ondragover = event => {
      const types = Array.from(event.dataTransfer?.types || []);
      const external = onImport && types.includes('Files');
      if (!external && !(onTransfer && types.includes(dragType))) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = external || event.ctrlKey || event.altKey ? 'copy' : 'move';
      element.classList.add('file-drop-target');
    };
    element.ondragleave = () => element.classList.remove('file-drop-target');
    element.ondrop = event => {
      element.classList.remove('file-drop-target');
      const incoming = Array.from(event.dataTransfer?.files || []);
      const source = event.dataTransfer?.getData(dragType);
      if (!(onImport && incoming.length) && !(onTransfer && source)) return;
      event.preventDefault();
      event.stopPropagation();
      if (onImport && incoming.length) onImport(incoming, directory);
      else onTransfer(source, `${directory}/${source.split('/').pop()}`, Boolean(event.ctrlKey || event.altKey));
    };
  }
  dropTarget(root, '');
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
        draggable(label, node.path);
        dropTarget(label, node.path);
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
        draggable(button, node.path);
        button.setAttribute('aria-current', String(node.path === selectedPath));
        button.addEventListener('click', () => { button.blur(); onOpen(node.path); });
        item.appendChild(button);
      }
      list.appendChild(item);
    }
    return list;
  }
  const tree = render(buildFileTree(files));
  if (onTransfer || onImport) {
    const project = document.createElement('div');
    project.className = 'file-tree-root';
    project.textContent = 'Project /';
    project.title = 'Drop files here to import or move to the project root. Hold Ctrl or Option to copy project files.';
    dropTarget(project, '');
    root.replaceChildren(project, tree);
  } else root.replaceChildren(tree);
}
