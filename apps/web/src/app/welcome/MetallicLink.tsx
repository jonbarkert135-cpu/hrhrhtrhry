import { ArrowRightIcon } from '@radix-ui/react-icons';
import { Link } from 'react-router-dom';

/** The supplied metallic-button reference, adapted to a native, keyboard-operable route link. */
export function MetallicLink({ children = 'Open workspace' }: { children?: React.ReactNode }) {
  return (
    <Link className="rvn-metal-link" to="/">
      <span>{children}</span>
      <ArrowRightIcon aria-hidden="true" />
    </Link>
  );
}
