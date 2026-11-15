import { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import AnimatedList from '../vendor/react-bits/AnimatedList.jsx';
import BranchedMenu from '../vendor/react-bits/BranchedMenu.jsx';

function ReadingLabel({ connection, reason }) {
  return <span className="network-result-text">
    <strong>{connection.node.title}</strong>
    <small className="network-result-reason">{reason}</small>
  </span>;
}

// BranchedMenu exposes a React label slot. Annotate its owning native button
// for the existing explorer's focus restoration without forking the component.
function BranchLabel({ connection, reason, selected }) {
  const label = useRef(null);
  useLayoutEffect(() => {
    const button = label.current?.closest('button');
    if (!button) return;
    button.classList.add('network-map-node');
    button.dataset.id = connection.node.id;
    button.dataset.kind = connection.kind;
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${connection.node.title}. ${reason}. Preview reading`);
    button.closest('nav')?.setAttribute('aria-label', 'Reading connections');
  });
  return <span ref={label} className="network-branch-label">
    <ReadingLabel connection={connection} reason={reason} />
  </span>;
}

function ListLabel({ connection, reason, selected }) {
  const label = useRef(null);
  useLayoutEffect(() => {
    const option = label.current?.closest('[role="option"]');
    if (!option) return;
    option.dataset.id = connection.node.id;
    option.dataset.kind = connection.kind;
    option.dataset.preview = String(selected);
    option.tabIndex = -1;
    option.setAttribute('aria-label', `${connection.node.title}. ${reason}. Preview reading`);
    option.closest('[role="listbox"]')?.setAttribute('aria-label', 'Related readings');
  });
  return <span ref={label} className="network-list-label">
    <span className="network-result-mark" aria-hidden="true">{connection.kind === 'related' ? '↗' : connection.kind === 'suggested' ? '◇' : '#'}</span>
    <ReadingLabel connection={connection} reason={reason} />
    <span className="network-result-arrow" aria-hidden="true">→</span>
  </span>;
}

function ConnectionResults({ view, focus, connections, selectedId, reasonLabel, onPreview }) {
  if (view === 'map') {
    const items = [{
      value: focus.id,
      label: <span className="network-branch-origin">
        <span className="network-item-meta">Starting reading</span>
        <strong>{focus.title}</strong>
        <span className="network-branch-hint">Show or hide connections</span>
      </span>,
      children: connections.map(connection => ({
        value: connection.node.id,
        label: <BranchLabel connection={connection} reason={reasonLabel(connection)} selected={selectedId === connection.node.id} />,
      })),
    }];
    return <div className="network-map" data-react-bits="BranchedMenu" aria-label={`Connections around ${focus.title}`}>
      <BranchedMenu key={focus.id} items={items} defaultOpen={0} defaultActive={selectedId || '__no_preview__'}
        onSelect={onPreview} color="var(--connection-ink)" accentColor="var(--connection-accent)"
        lineColor="var(--connection-line)" width={1000} rowHeight={88} indent={40} trunk={14}
        fontSize={13} drawDuration={200} foldDuration={180} className="network-branches" />
    </div>;
  }
  const items = connections.map(connection => ({ ...connection, id: connection.node.id }));
  return <div className="network-list" data-react-bits="AnimatedList">
    <AnimatedList key={focus.id} items={items} onItemSelect={item => onPreview(item.node.id)}
      initialSelectedIndex={items.findIndex(item => item.id === selectedId)}
      animation="none" enableArrowNavigation selectOnHover frame={false} showGradients={false}
      displayScrollbar={false} width="100%" maxHeight="none" radius={8} gap={6} itemClassName="network-neighbour"
      accentColor="var(--connection-accent)" className="network-animated-list"
      style={{ '--al-ink': 'var(--connection-ink)', '--al-muted': 'var(--connection-muted)', '--al-tile': 'var(--connection-panel)', '--al-tile-shadow': 'none' }}
      renderItem={connection => <ListLabel connection={connection} reason={reasonLabel(connection)} selected={selectedId === connection.node.id} />} />
  </div>;
}

/** A real React root inside the existing DOM explorer; no port or imitation. */
export function mountConnectionResults(container, props) {
  const root = createRoot(container);
  let alive = true;
  function update(next) {
    if (!alive) return;
    // The imperative explorer restores focus immediately after updates. Flush
    // only this small integration boundary so its native DOM controls exist.
    flushSync(() => root.render(<ConnectionResults {...next} />));
  }
  update(props);
  return { update, destroy() { if (alive) { alive = false; root.unmount(); } } };
}
