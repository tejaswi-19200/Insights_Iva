import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import Button from "../../components/common/Button";
import { ListPageShell } from "../../components/common/ListPageShell";
import SalesJobCardDocumentPanel from "../../components/manufacturing/SalesJobCardDocumentPanel";
import SendJobCardModal from "../../components/manufacturing/SendJobCardModal";
import useAuth from "../../hooks/useAuth";
import { userCanAction, userCanCreateSalesJobCard } from "../../config/permissions";
import { jobCardManualEditUrl } from "../../utils/jobCardRoutes";
import "../../styles/my-job-cards-page.css";

export default function ViewManualJobCardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sendTarget, setSendTarget] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const canEdit =
    userCanAction(user, "sales", "update") || userCanCreateSalesJobCard(user);
  const listPath = "/my-job-cards?dept=sales";

  return (
    <ListPageShell className="my-job-cards-page" stackClassName="my-job-cards-page__stack">
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(listPath)}
          leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden />}
        >
          Back to My Job Cards
        </Button>
      </div>
      <SalesJobCardDocumentPanel
        key={`${id}-${reloadKey}`}
        jobCardId={id}
        listPath={listPath}
        canEdit={canEdit}
        onEdit={() => navigate(jobCardManualEditUrl(id))}
        onSend={(card) => setSendTarget({ ...card, job_card_id: card.job_card_id || id })}
        showToolbarSendButton={false}
        showEmptyShell={false}
      />
      <SendJobCardModal
        open={Boolean(sendTarget)}
        jobCard={sendTarget}
        onClose={() => setSendTarget(null)}
        onSent={() => setReloadKey((current) => current + 1)}
      />
    </ListPageShell>
  );
}
