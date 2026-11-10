import React from 'react';
import { useAuth } from '../../AuthContext';

/** Instructions only: never impersonates another role or exposes their records. */
export function ApprovalFinanceGuide() {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  return <details className="card">
    <summary><strong>{sw ? 'Jinsi Huduma na Payroll zinavyopita kwenye idhini na malipo' : 'How Services and Payroll move through approval and payment'}</strong></summary>
    <div className="stack">
      <p>{sw ? 'Payroll: Mtoa huduma → CTC → Kitaalamu → RM → ripoti ya mwezi. Huduma: Mtoa huduma → CTC → Kitaalamu → RM → Fedha ya Mkoa (jedwali, kisha malipo) → FHI360 → malipo na uthibitisho.' : 'Payroll: Provider → CTC → Technical → RM → monthly report. Services: Provider → CTC → Technical → RM → Regional Finance (timesheet, then payment) → FHI360 → payment and proof.'}</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{sw ? 'Jukumu / skrini' : 'Role / screen'}</th><th>{sw ? 'Kinachoonekana' : 'What appears'}</th><th>{sw ? 'Hatua inayofuata' : 'Next action'}</th></tr></thead>
        <tbody>
          <tr><td>{sw ? 'Mkuu wa CTC · Mapitio ya majedwali' : 'CTC In-Charge · Work log reviews'}</td><td>{sw ? 'Rekodi za kituo chako.' : 'Records from your facility.'}</td><td>{sw ? 'Hakiki; kisha inakwenda kwa Kitaalamu.' : 'Verify; it then goes to Technical.'}</td></tr>
          <tr><td>{sw ? 'Mkuu wa Kituo · Mapitio ya majedwali' : 'Facility In-Charge · Work log reviews'}</td><td>{sw ? 'Majedwali yote ya kituo chako.' : 'All timesheets at your facility.'}</td><td>{sw ? 'Kusoma tu.' : 'Read only.'}</td></tr>
          <tr><td>{sw ? 'Kitaalamu wa CSO · Mapitio ya majedwali' : 'CSO Technical · Work log reviews'}</td><td>{sw ? 'Watoa huduma wa jamii wasio na kituo.' : 'Community providers with no facility.'}</td><td>{sw ? 'Idhini ya kwanza; kisha Kitaalamu wa FHI360.' : 'First approval; then FHI360 Technical.'}</td></tr>
          <tr><td>{sw ? 'Kitaalamu wa FHI360 · Mapitio ya majedwali' : 'FHI360 Technical · Work log reviews'}</td><td>{sw ? 'Rekodi zilizohakikiwa na CTC.' : 'CTC-verified records.'}</td><td>{sw ? 'Idhinisha au rudisha; kisha RM.' : 'Endorse or return; then RM.'}</td></tr>
          <tr><td>{sw ? 'RM · Mapitio ya majedwali' : 'RM · Work log reviews'}</td><td>{sw ? 'Kada zote katika mikoa yako.' : 'All cadres in your regions.'}</td><td>{sw ? 'Idhinisha kila rekodi.' : 'Authorize each record.'}</td></tr>
          <tr><td>{sw ? 'Fedha ya Mkoa · Ripoti ya mwezi / Huduma za kukagua' : 'Regional Finance · Monthly report / Services routing'}</td><td>{sw ? 'Viashiria na masaa ya mwezi.' : 'Monthly indicators and hours.'}</td><td>{sw ? 'Chagua mlipaji wa Huduma na utume.' : 'Choose the Services payor and route.'}</td></tr>
          <tr><td>{sw ? 'Fedha ya FHI360 · Madai ya malipo' : 'FHI360 Finance · Payment claims'}</td><td>{sw ? 'Huduma zilizotumwa FHI360.' : 'Services routed to FHI360.'}</td><td>{sw ? 'Rekodi malipo, ambatisha uthibitisho, patanisha.' : 'Record payment, attach proof, reconcile.'}</td></tr>
          <tr><td>{sw ? 'Madai ya jamii · Fedha ya CSO iliyopangiwa' : 'Community claims · assigned CSO Finance'}</td><td>{sw ? 'Madai ya jamii yaliyohakikiwa.' : 'Verified community claims.'}</td><td>{sw ? 'Idhinisha, lipa nje, ambatisha uthibitisho.' : 'Approve, pay externally, attach proof.'}</td></tr>
        </tbody>
      </table></div>
    </div>
  </details>;
}
