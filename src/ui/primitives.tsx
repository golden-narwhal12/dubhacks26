import type { ButtonHTMLAttributes, ReactNode } from 'react';
/** Text glyphs stay decorative; the parent control owns its accessible label. */
export function TerminalGlyph({
  value = '>_',
  large = false,
}: {
  value?: string;
  large?: boolean;
}) {
  return (
    <span aria-hidden="true" className={`terminal-glyph${large ? ' large' : ''}`}>
      {value}
    </span>
  );
}
export function IconButton({
  title,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button className="icon-button" title={title} aria-label={title} {...props}>
      {children}
    </button>
  );
}
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p>{title}</p>
      {children}
    </div>
  );
}
