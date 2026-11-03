interface FaIconProps {
  name: string;
  size: number;
}

export default function FaIcon({ name, size }: FaIconProps) {
  return (
    <i
      aria-hidden
      className={`fa-solid ${name} leading-none`}
      style={{ fontSize: size, filter: 'drop-shadow(0 0 4px rgba(34,197,94,0.7))' }}
    />
  );
}
