interface SwitchProps {
  checked: boolean;
  onChange: () => void;
  "aria-label"?: string;
}

/** Design-system toggle: 36×20 pill track, white knob slides right when on. */
export function Switch({ checked, onChange, ...rest }: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
        checked ? "bg-series-1" : "bg-[#2a2d36]"
      }`}
      {...rest}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left] duration-200 ${
          checked ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
