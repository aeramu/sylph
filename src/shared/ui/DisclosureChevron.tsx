import './DisclosureChevron.css';

export default function DisclosureChevron(props: {
  expanded: boolean;
  class?: string;
  size?: number;
}) {
  const size = () => props.size ?? 12;

  return (
    <svg
      class={`disclosure-chevron ${props.expanded ? 'expanded' : ''} ${props.class ?? ''}`}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
