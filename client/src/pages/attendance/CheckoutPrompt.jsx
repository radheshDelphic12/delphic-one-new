import { useNavigate } from 'react-router-dom';
import Modal from '../../components/ui/Modal.jsx';

/** IT staff: "log your timesheet first" before checking out. */
export default function CheckoutPrompt({ open, onClose, onConfirm }) {
  const navigate = useNavigate();
  return (
    <Modal
      open={open}
      title="Before you check out"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => { onClose(); navigate('/attendance?section=it-timesheet'); }}>Log Timesheet First</button>
          <button type="button" className="btn-primary" onClick={onConfirm}>Confirm Checkout</button>
        </>
      }
    >
      <p className="text-tertiary-700">Please make sure you have logged your timesheet before checking out.</p>
    </Modal>
  );
}
