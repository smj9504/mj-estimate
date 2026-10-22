import React from 'react';
import './AuthLayout.css';

interface AuthLayoutProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * The signed-out pages (sign in, forgot and reset password): the brand in the
 * corner and one narrow column directly on the white sheet, no card.
 */
const AuthLayout: React.FC<AuthLayoutProps> = ({ title, description, children }) => (
  <div className="auth-page">
    <header className="auth-brand">
      <span className="auth-brand-mark" aria-hidden="true">S</span>
      <span>SimpleWorks</span>
    </header>
    <main className="auth-main">
      <div className="auth-column">
        {(title || description) && (
          <div className="auth-head">
            {title && <h1 className="auth-title">{title}</h1>}
            {description && <p className="auth-description">{description}</p>}
          </div>
        )}
        {children}
      </div>
    </main>
  </div>
);

interface AuthFieldLabelProps {
  htmlFor: string;
  children: React.ReactNode;
  /** A link at the right end of the label row, such as "Forgot password?" */
  action?: React.ReactNode;
}

/** A visible field label; antd's own label can't hold a link beside it. */
export const AuthFieldLabel: React.FC<AuthFieldLabelProps> = ({ htmlFor, children, action }) => (
  <div className="auth-label-row">
    <label htmlFor={htmlFor} className="auth-label">{children}</label>
    {action}
  </div>
);

export default AuthLayout;
