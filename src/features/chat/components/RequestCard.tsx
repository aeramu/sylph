import type { JSX } from 'solid-js';

export interface RequestCardKeyboardActions {
  cancel?: () => void;
  move?: (direction: 1 | -1) => void;
  toggle?: () => void;
  primary?: () => void;
  submit?: () => void;
}

export default function RequestCard(props: {
  title: JSX.Element;
  subtitle: JSX.Element;
  children: JSX.Element;
  actions: JSX.Element;
  icon?: JSX.Element;
  class?: string;
  actionsClass?: string;
  cardRef?: (element: HTMLDivElement) => void;
  keyboard?: RequestCardKeyboardActions;
}) {
  const handleKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    const target = event.target as HTMLElement | null;
    const isTextInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
    const isActionButton = !!target?.closest?.('.ui-request-actions');

    if (event.key === 'Escape' && props.keyboard?.cancel) {
      event.preventDefault();
      props.keyboard.cancel();
    } else if (!isActionButton && event.key === 'ArrowDown' && props.keyboard?.move) {
      event.preventDefault();
      props.keyboard.move(1);
    } else if (!isActionButton && event.key === 'ArrowUp' && props.keyboard?.move) {
      event.preventDefault();
      props.keyboard.move(-1);
    } else if (!isTextInput && !isActionButton && event.key === ' ' && props.keyboard?.toggle) {
      event.preventDefault();
      props.keyboard.toggle();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && props.keyboard?.submit) {
      event.preventDefault();
      props.keyboard.submit();
    } else if (!isActionButton && event.key === 'Enter' && !event.shiftKey && props.keyboard?.primary) {
      event.preventDefault();
      props.keyboard.primary();
    }
  };

  return (
    <div
      ref={props.cardRef}
      class={`ui-request-card ${props.class ?? ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div class="ui-request-header">
        <div class="ui-request-icon">{props.icon ?? '?'}</div>
        <div>
          <h3 class="ui-request-title">{props.title}</h3>
          <div class="ui-request-subtitle">{props.subtitle}</div>
        </div>
      </div>
      {props.children}
      <div class={`ui-request-actions ${props.actionsClass ?? ''}`}>{props.actions}</div>
    </div>
  );
}
