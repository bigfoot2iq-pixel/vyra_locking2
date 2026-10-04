/** Says up front how many wallet confirmations are coming, so the pop-ups aren't a surprise. */
export function WalletHint({ count, oneTime }: { count: number; oneTime: boolean }) {
  if (count < 2) return null;
  return (
    <p className="wallet-hint">
      Your wallet will ask you to confirm {count} times.
      {oneTime && " Letting the Keep hold your guardians only happens once."}
    </p>
  );
}
