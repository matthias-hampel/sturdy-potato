import { type CalendarDate, parseDate } from '@internationalized/date'
import { Calendar as CalendarIcon, Check, ChevronDown, ChevronLeft, ChevronRight, Minus, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  Checkbox as AriaCheckbox,
  type CheckboxProps,
  ComboBox as AriaComboBox,
  type ComboBoxProps as AriaComboBoxProps,
  DateInput,
  DatePicker as AriaDatePicker,
  DateSegment,
  Dialog,
  FieldError as AriaFieldError,
  Group,
  Heading,
  Input,
  type Key,
  Label as AriaLabel,
  ListBox,
  ListBoxItem,
  type ListBoxItemProps,
  NumberField as AriaNumberField,
  type NumberFieldProps as AriaNumberFieldProps,
  Popover,
  SearchField as AriaSearchField,
  type SearchFieldProps,
  Select as AriaSelect,
  type SelectProps as AriaSelectProps,
  SelectValue,
  Switch as AriaSwitch,
  type SwitchProps,
  Text,
  TextArea as AriaTextArea,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
} from 'react-aria-components'
import { composeClass, cx, focusRing } from './utils'
import { t } from '#/i18n'

export const inputClass = cx(
  'w-full min-w-0 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 h-9.5 text-sm text-fg',
  'placeholder:text-muted outline-none transition-shadow',
  'focus:border-primary focus:ring-2 focus:ring-primary/25 invalid:border-danger disabled:bg-surface-2 disabled:text-muted',
)

const groupClass = cx(
  'flex items-center w-full rounded-[var(--radius-control)] border border-line-strong bg-surface h-9.5 text-sm overflow-hidden',
  'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25 invalid:border-danger disabled:bg-surface-2',
)

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <AriaLabel className={cx('text-sm font-medium text-fg-2', className)}>{children}</AriaLabel>
}

function Help({ description, errorMessage }: { description?: ReactNode; errorMessage?: string | ((v: ValidationResult) => string) }) {
  return (
    <>
      {description && (
        <Text slot="description" className="text-xs text-muted">
          {description}
        </Text>
      )}
      <AriaFieldError className="text-xs text-danger">{errorMessage}</AriaFieldError>
    </>
  )
}

interface FieldBase {
  label?: ReactNode
  description?: ReactNode
  errorMessage?: string | ((v: ValidationResult) => string)
}

const fieldClass = 'flex flex-col gap-1.5 min-w-0'

export interface TextFieldProps extends AriaTextFieldProps, FieldBase {
  placeholder?: string
  multiline?: boolean
  rows?: number
}

export function TextField({ label, description, errorMessage, placeholder, multiline, rows = 3, className, ...props }: TextFieldProps) {
  return (
    <AriaTextField {...props} className={composeClass(className, fieldClass)}>
      {label && <Label>{label}</Label>}
      {multiline ? (
        <AriaTextArea rows={rows} placeholder={placeholder} className={cx(inputClass, 'h-auto py-2 resize-y')} />
      ) : (
        <Input placeholder={placeholder} className={inputClass} />
      )}
      <Help description={description} errorMessage={errorMessage} />
    </AriaTextField>
  )
}

export interface NumberFieldProps extends AriaNumberFieldProps, FieldBase {
  unit?: string
  placeholder?: string
}

/** Numeric input; `value` is NaN when empty (React Aria convention). */
export function NumberField({ label, description, errorMessage, unit, placeholder, className, ...props }: NumberFieldProps) {
  return (
    <AriaNumberField {...props} className={composeClass(className, fieldClass)}>
      {label && <Label>{label}</Label>}
      <Group className={groupClass}>
        <Input placeholder={placeholder} className="flex-1 min-w-0 bg-transparent px-3 h-full outline-none tabular text-fg" />
        {unit && <span className="pr-3 text-muted text-sm whitespace-nowrap">{unit}</span>}
      </Group>
      <Help description={description} errorMessage={errorMessage} />
    </AriaNumberField>
  )
}

export interface SelectProps<T extends object> extends Omit<AriaSelectProps<T>, 'children' | 'value' | 'onChange'>, FieldBase {
  items: Iterable<T>
  children: ReactNode | ((item: T) => ReactNode)
  value?: Key | null
  onChange?: (value: Key | null) => void
}

export function Select<T extends object>({ label, description, errorMessage, items, children, className, value, onChange, ...props }: SelectProps<T>) {
  return (
    <AriaSelect {...props} value={value} onChange={(v) => onChange?.(v as Key | null)} className={composeClass(className, fieldClass)}>
      {label && <Label>{label}</Label>}
      <AriaButton className={cx(groupClass, 'px-3 justify-between gap-2 text-left cursor-pointer', focusRing)}>
        <SelectValue className="truncate placeholder-shown:text-muted text-fg">
          {({ selectedText, isPlaceholder, defaultChildren }) => (isPlaceholder ? defaultChildren : selectedText || defaultChildren)}
        </SelectValue>
        <ChevronDown className="size-4 text-muted shrink-0" aria-hidden />
      </AriaButton>
      <Help description={description} errorMessage={errorMessage} />
      <ListPopover>
        <ListBox items={items} className="outline-none p-1 max-h-80 overflow-auto">
          {children}
        </ListBox>
      </ListPopover>
    </AriaSelect>
  )
}

export function ListPopover({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Popover
      offset={4}
      className={cx(
        'min-w-(--trigger-width) rounded-[var(--radius-control)] border border-line bg-surface shadow-[var(--shadow-overlay)]',
        className,
      )}
    >
      {children}
    </Popover>
  )
}

export function Option({ children, description, ...props }: ListBoxItemProps & { children: ReactNode; description?: ReactNode }) {
  const textValue = props.textValue ?? (typeof children === 'string' ? children : undefined)
  return (
    <ListBoxItem
      {...props}
      textValue={textValue}
      className={cx(
        'group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-fg outline-none cursor-default',
        'hover:bg-surface-2 focus:bg-surface-2 selected:font-medium disabled:opacity-50',
      )}
    >
      {({ isSelected }) => (
        <>
          <span className="flex-1 min-w-0">
            <span className="block truncate">{children}</span>
            {description && <span className="block text-xs text-muted truncate">{description}</span>}
          </span>
          <Check className={cx('size-4 text-primary shrink-0', !isSelected && 'invisible')} aria-hidden />
        </>
      )}
    </ListBoxItem>
  )
}

export interface ComboBoxProps<T extends object> extends Omit<AriaComboBoxProps<T>, 'children' | 'value' | 'onChange'>, FieldBase {
  items?: Iterable<T>
  children: ReactNode | ((item: T) => ReactNode)
  placeholder?: string
  value?: Key | null
  onChange?: (value: Key | null) => void
}

export function ComboBox<T extends object>({ label, description, errorMessage, items, children, placeholder, className, value, onChange, ...props }: ComboBoxProps<T>) {
  return (
    <AriaComboBox {...props} value={value} onChange={(v) => onChange?.(v as Key | null)} className={composeClass(className, fieldClass)}>
      {label && <Label>{label}</Label>}
      <Group className={groupClass}>
        <Input placeholder={placeholder} className="flex-1 min-w-0 bg-transparent px-3 h-full outline-none text-fg placeholder:text-muted" />
        <AriaButton className="px-2 h-full text-muted hover:text-fg outline-none">
          <ChevronDown className="size-4" aria-hidden />
        </AriaButton>
      </Group>
      <Help description={description} errorMessage={errorMessage} />
      <ListPopover>
        <ListBox items={items} className="outline-none p-1 max-h-80 overflow-auto">
          {children}
        </ListBox>
      </ListPopover>
    </AriaComboBox>
  )
}

export function Checkbox({ children, className, ...props }: CheckboxProps & { children?: ReactNode }) {
  return (
    <AriaCheckbox {...props} className={composeClass(className, 'group inline-flex items-center gap-2 text-sm text-fg cursor-default')}>
      {({ isSelected, isIndeterminate }) => (
        <>
          <span
            className={cx(
              'size-4.5 rounded-[5px] border flex items-center justify-center transition-colors shrink-0',
              'group-focus-visible:ring-2 group-focus-visible:ring-primary/50',
              isSelected || isIndeterminate ? 'bg-primary border-primary text-primary-fg' : 'bg-surface border-line-strong',
            )}
          >
            {isIndeterminate ? <Minus className="size-3.5" /> : isSelected ? <Check className="size-3.5" strokeWidth={3} /> : null}
          </span>
          {children}
        </>
      )}
    </AriaCheckbox>
  )
}

export function Switch({ children, className, ...props }: SwitchProps & { children?: ReactNode }) {
  return (
    <AriaSwitch {...props} className={composeClass(className, 'group inline-flex items-center gap-2.5 text-sm text-fg cursor-default')}>
      <span className="h-5 w-9 rounded-full bg-surface-3 border border-line-strong transition-colors group-selected:bg-primary group-selected:border-primary group-focus-visible:ring-2 group-focus-visible:ring-primary/50 relative">
        <span className="absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow transition-transform group-selected:translate-x-4" />
      </span>
      {children}
    </AriaSwitch>
  )
}

export interface DateFieldProps extends FieldBase {
  'aria-label'?: string
  value: string | null | undefined
  onChange: (value: string | null) => void
  isRequired?: boolean
  isDisabled?: boolean
  minValue?: string
  maxValue?: string
  className?: string
  name?: string
}

/** Date picker working with ISO dates (YYYY-MM-DD). */
export function DatePicker({ label, description, errorMessage, value, onChange, minValue, maxValue, className, ...props }: DateFieldProps) {
  const parsed = value ? safeParse(value) : null
  return (
    <AriaDatePicker
      {...props}
      value={parsed}
      onChange={(d) => onChange(d ? d.toString() : null)}
      minValue={minValue ? safeParse(minValue) : undefined}
      maxValue={maxValue ? safeParse(maxValue) : undefined}
      className={cx(fieldClass, className)}
    >
      {label && <Label>{label}</Label>}
      <Group className={cx(groupClass, 'pl-3')}>
        <DateInput className="flex flex-1 tabular">
          {(segment) => (
            <DateSegment
              segment={segment}
              className="rounded px-0.5 outline-none text-fg placeholder-shown:text-muted focus:bg-primary focus:text-primary-fg type-literal:px-0"
            />
          )}
        </DateInput>
        <AriaButton className="px-2.5 h-full text-muted hover:text-fg outline-none focus-visible:text-primary">
          <CalendarIcon className="size-4" aria-hidden />
        </AriaButton>
      </Group>
      <Help description={description} errorMessage={errorMessage} />
      <Popover offset={4} className="rounded-xl border border-line bg-surface shadow-[var(--shadow-overlay)]">
        <Dialog className="p-3 outline-none">
          <CalendarView />
        </Dialog>
      </Popover>
    </AriaDatePicker>
  )
}

function safeParse(v: string): CalendarDate | null {
  try {
    return parseDate(v.slice(0, 10))
  } catch {
    return null
  }
}

function CalendarView() {
  return (
    <Calendar className="w-fit">
      <header className="flex items-center justify-between pb-2 gap-2">
        <AriaButton slot="previous" className="size-8 rounded-md flex items-center justify-center hover:bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
          <ChevronLeft className="size-4" />
        </AriaButton>
        <Heading className="text-sm font-semibold text-fg" />
        <AriaButton slot="next" className="size-8 rounded-md flex items-center justify-center hover:bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
          <ChevronRight className="size-4" />
        </AriaButton>
      </header>
      <CalendarGrid className="border-separate border-spacing-0.5">
        {(date) => (
          <CalendarCell
            date={date}
            className={cx(
              'size-8 text-sm rounded-md flex items-center justify-center outline-none cursor-default tabular text-fg',
              'hover:bg-surface-2 selected:bg-primary selected:text-primary-fg outside-month:text-muted/50 disabled:text-muted/40',
              'focus-visible:ring-2 focus-visible:ring-primary/50',
            )}
          />
        )}
      </CalendarGrid>
    </Calendar>
  )
}

export function SearchField({ placeholder = t('common.search'), className, ...props }: SearchFieldProps & { placeholder?: string }) {
  return (
    <AriaSearchField {...props} aria-label={props['aria-label'] ?? placeholder} className={composeClass(className, 'group min-w-0')}>
      <Group className={groupClass}>
        <Search className="size-4 ml-3 text-muted shrink-0" aria-hidden />
        <Input placeholder={placeholder} className="flex-1 min-w-0 bg-transparent px-2 h-full outline-none text-fg placeholder:text-muted [&::-webkit-search-cancel-button]:hidden" />
        <AriaButton className="px-2 text-muted hover:text-fg group-empty:invisible outline-none">
          <X className="size-4" />
        </AriaButton>
      </Group>
    </AriaSearchField>
  )
}

/** Convert a React Aria NumberField value (NaN when empty) to number | null. */
export const num = (v: number) => (Number.isNaN(v) ? null : v)
