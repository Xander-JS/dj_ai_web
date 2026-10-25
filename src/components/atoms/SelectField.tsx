import React, { type SelectHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { Icon } from './Icon';
import './SelectField.css';

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** sm: celdas y barras densas · md: predeterminado */
  size?: 'sm' | 'md';
  wrapperClassName?: string;
}

// <select> nativo con la forma píldora del sistema: conserva teclado, lectores y selector del sistema
export const SelectField = React.forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ size = 'md', className, wrapperClassName, children, ...props }, ref) => (
    <span className={clsx('sd-select-field', `sd-select-field--${size}`, wrapperClassName)}>
      <select ref={ref} className={clsx('sd-select-field__control', className)} {...props}>
        {children}
      </select>
      <Icon icon={ChevronDown} size="sm" className="sd-select-field__chevron" />
    </span>
  ),
);

SelectField.displayName = 'SelectField';
