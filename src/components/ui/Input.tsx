import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const controlBase =
  "w-full rounded-md border border-ink-200 bg-white px-4 py-3 text-base " +
  "text-ink-900 placeholder:text-ink-400 shadow-sm " +
  "focus:border-blood-600 focus:ring-2 focus:ring-blood-100 focus:outline-none " +
  "disabled:cursor-not-allowed disabled:bg-ink-100";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ label, hint, error, className, id, ...rest }, ref) {
    const inputId = id ?? rest.name;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-base font-semibold text-ink-900">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cn(controlBase, error && "border-red-500", className)}
          {...rest}
        />
        {hint && !error && (
          <p id={`${inputId}-hint`} className="mt-1.5 text-sm text-ink-600">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-sm font-medium text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, hint, error, className, id, children, ...rest }, ref) {
    const selectId = id ?? rest.name;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="mb-1.5 block text-base font-semibold text-ink-900">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(controlBase, error && "border-red-500", className)}
          {...rest}
        >
          {children}
        </select>
        {hint && !error && (
          <p className="mt-1.5 text-sm text-ink-600">{hint}</p>
        )}
        {error && (
          <p role="alert" className="mt-1.5 text-sm font-medium text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, hint, error, className, id, ...rest }, ref) {
    const areaId = id ?? rest.name;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={areaId} className="mb-1.5 block text-base font-semibold text-ink-900">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={areaId}
          className={cn(controlBase, "min-h-28", error && "border-red-500", className)}
          {...rest}
        />
        {hint && !error && <p className="mt-1.5 text-sm text-ink-600">{hint}</p>}
        {error && (
          <p role="alert" className="mt-1.5 text-sm font-medium text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);
