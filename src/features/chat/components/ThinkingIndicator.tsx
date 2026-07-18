import './ThinkingIndicator.css';

export default function ThinkingIndicator() {
  return (
    <div class="thinking-indicator" role="status" aria-label="Assistant is responding">
      <span class="thinking-dot" />
      <span class="thinking-dot" />
      <span class="thinking-dot" />
    </div>
  );
}
