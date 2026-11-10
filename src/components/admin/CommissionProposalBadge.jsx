import React from 'react';
import { Clock, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const KEY = 'remittances.admin.commissionProposal';

/** Admin badge: state of the customer-facing commission proposal (text + icon, never color alone). */
const CommissionProposalBadge = ({ proposal }) => {
  const { t } = useLanguage();
  if (!proposal) return null;
  const isPending = proposal.status === 'pending';
  const Icon = isPending ? Clock : Info;
  return (
    <span
      title={isPending ? t(`${KEY}.pendingHelp`) : undefined}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${
        isPending ? 'bg-amber-50 text-amber-900 border-amber-400' : 'bg-green-50 text-green-900 border-green-400'
      }`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {isPending ? t(`${KEY}.pending`) : t(`${KEY}.informed`)}
    </span>
  );
};

export default CommissionProposalBadge;
