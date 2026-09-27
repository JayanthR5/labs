import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Search, Send, Upload, LogOut, Slack, Clock3, CheckCircle2, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';
import { authApi, emailApi, senderApi, slackApi, Email, Sender, User, SlackChannel, SlackStatus } from './api';
import './styles.css';

const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function Login() { return <main className="login"><div className="login-panel"><div className="mark">R</div><p className="eyebrow">OUTBOUND OPERATIONS</p><h1>ReachInbox</h1><p className="muted">Schedule thoughtful email sequences with a clear view of every send.</p><a className="google-button" href="http://localhost:4000/api/auth/google">Continue with Google</a><p className="fine">Google OAuth is required for workspace access.</p></div></main>; }
function App() { const [user, setUser] = useState<User | null>(null); const [loading, setLoading] = useState(true); useEffect(() => { authApi.me().then(({ data }) => setUser(data.user)).catch(() => undefined).finally(() => setLoading(false)); }, []); if (loading) return <div className="loading">Loading workspace...</div>; return user ? <Dashboard user={user} onLogout={() => authApi.logout().then(() => setUser(null))} /> : <Login />; }
const statusLabel = (status: string) => ({ scheduled: 'Scheduled', sent: 'Sent', failed: 'Failed', processing: 'Processing', cancelled: 'Cancelled' }[status] ?? status);
const emailTime = (tab: 'scheduled' | 'sent' | 'failed', email: Email) => tab === 'sent' ? email.sentAt : tab === 'failed' ? email.sentAt ?? email.scheduledAt : email.scheduledAt;

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
	const [tab, setTab] = useState<'scheduled'|'sent'|'failed'>('scheduled');
	const [emails, setEmails] = useState<Email[]>([]);
	const [senders, setSenders] = useState<Sender[]>([]);
	const [query, setQuery] = useState('');
	const [compose, setCompose] = useState(false);
	const [slack, setSlack] = useState(false);
	const [slackDetails, setSlackDetails] = useState<SlackStatus>({ connected: false });
	const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([]);
	const [slackChannelId, setSlackChannelId] = useState('');
	const load = () => emailApi.list(tab).then(({ data }) => setEmails(data.items));
	useEffect(() => { void load(); void senderApi.list().then(({ data }) => setSenders(data)); void slackApi.status().then(({ data }) => { setSlack(data.connected); setSlackDetails(data); setSlackChannelId(data.channelId ?? ''); if (data.connected) void slackApi.channels().then(({ data: channelData }) => setSlackChannels(channelData.channels)); }); }, [tab]);
	useEffect(() => { if (!query.trim()) { void load(); return; } const timer = window.setTimeout(() => { void emailApi.search(query).then(({ data }) => setEmails(data.items)); }, 300); return () => window.clearTimeout(timer); }, [query]);
	return <div className="app"><header><div className="brand"><span className="mark small">R</span><span>ReachInbox</span></div><div className="profile"><img src={user.avatarUrl ?? 'https://api.dicebear.com/9.x/initials/svg?seed=User'} /><span><b>{user.name}</b><small>{user.email}</small></span><button className="icon-button" title="Log out" onClick={onLogout}><LogOut size={17}/></button></div></header><main className="content"><section className="hero"><div><p className="eyebrow">CAMPAIGN CONTROL ROOM</p><h2>Good morning, {user.name.split(' ')[0]}.</h2><p className="muted">Keep your sending queue deliberate, observable, and moving.</p></div><button className="primary" onClick={() => setCompose(true)}><Send size={17}/> Compose email</button></section><section className="metrics"><Metric icon={<Clock3/>} label="Scheduled" value={tab === 'scheduled' ? emails.length : '—'} tone="yellow"/><Metric icon={<CheckCircle2/>} label="Delivered" value={tab === 'sent' ? emails.length : '—'} tone="green"/><Metric icon={<AlertCircle/>} label="Needs attention" value={tab === 'failed' ? emails.length : '—'} tone="red"/></section><section className="toolbar"><div className="tabs">{(['scheduled','sent','failed'] as const).map(item => <button className={tab === item ? 'active' : ''} onClick={() => { setQuery(''); setTab(item); }} key={item}>{item}</button>)}</div><label className="search"><Search size={17}/><input placeholder="Search emails..." value={query} onChange={e => setQuery(e.target.value)}/></label></section><section className="table-wrap"><table><thead><tr><th>Recipient</th><th>Subject</th><th>{tab === 'sent' ? 'Sent time' : tab === 'failed' ? 'Failed/Scheduled time' : 'Scheduled time'}</th><th>Status</th>{tab === 'failed' && <th>Error</th>}</tr></thead><tbody>{emails.map(email => <tr key={email.id}><td><b>{email.recipient}</b></td><td>{email.subject}</td><td>{emailTime(tab, email) ? new Date(emailTime(tab, email) as string).toLocaleString() : '—'}</td><td><span className={`status ${email.status}`}>{statusLabel(email.status)}</span></td>{tab === 'failed' && <td>{email.errorMessage ?? '—'}</td>}</tr>)}</tbody></table>{emails.length === 0 && <div className="empty">No {tab} emails yet.</div>}</section><section className="slack-row"><div><div className="slack-title"><Slack size={19}/> Slack notifications</div><p className="muted">{slack ? `${slackDetails.teamName ?? 'Slack workspace'}${slackChannelId ? ` / #${slackChannels.find(channel => channel.id === slackChannelId)?.name ?? slackChannelId}` : ' / Choose a channel'}` : 'Get notified when a sender reaches its hourly limit.'}</p>{slack && slackChannels.length > 0 && <select className="slack-channel" value={slackChannelId} onChange={event => { const id = event.target.value; setSlackChannelId(id); setSlackDetails(current => ({ ...current, channelId: id })); void slackApi.selectChannel(id); }}><option value="">Choose Slack channel</option>{slackChannels.map(channel => <option key={channel.id} value={channel.id}>#{channel.name}{channel.isPrivate ? ' (private)' : ''}</option>)}</select>}</div>{slack ? <button className="secondary" onClick={() => slackApi.disconnect().then(() => { setSlack(false); setSlackDetails({ connected: false }); setSlackChannelId(''); setSlackChannels([]); })}>Disconnect</button> : <a className="secondary" href="http://localhost:4000/api/slack/connect"><Slack size={16}/> Connect Slack</a>}</section></main>{compose && <Compose senders={senders} onClose={() => setCompose(false)} onDone={() => { setCompose(false); setTab('scheduled'); void load(); }}/>}</div>;
}
function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number|string; tone: string }) { return <div className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><div><small>{label}</small><strong>{value}</strong></div></div>; }
function SenderForm({ onClose, onDone }: { onClose: () => void; onDone: (sender: Sender) => void }) {
	const [email, setEmail] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [smtpHost, setSmtpHost] = useState('smtp.ethereal.email');
	const [smtpPort, setSmtpPort] = useState(587);
	const [smtpUser, setSmtpUser] = useState('');
	const [smtpPassword, setSmtpPassword] = useState('');
	const [error, setError] = useState('');
	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError('');
		if (!validEmail.test(email.trim())) return setError('Enter a valid sender email address.');
		if (!smtpHost.trim()) return setError('SMTP host is required.');
		if (!Number.isInteger(Number(smtpPort)) || Number(smtpPort) < 1 || Number(smtpPort) > 65535) return setError('Enter a valid SMTP port.');
		if (!smtpUser.trim()) return setError('SMTP username is required.');
		if (!smtpPassword) return setError('SMTP password is required.');
		try {
			const { data } = await senderApi.create({ email: email.trim(), displayName: displayName.trim() || undefined, smtpHost: smtpHost.trim(), smtpPort: Number(smtpPort), smtpUser: smtpUser.trim(), smtpPassword });
			onDone(data);
		} catch (requestError: unknown) {
			const response = requestError as { response?: { data?: { error?: string } } };
			setError(response.response?.data?.error ?? 'Unable to add sender.');
		}
	};
	return <div className="overlay"><form className="compose sender-form" onSubmit={submit}><div className="compose-head"><div><p className="eyebrow">SENDER SETTINGS</p><h3>Add Sender</h3></div><button type="button" className="close" onClick={onClose}>×</button></div><p className="muted">Use a valid From address separately from your Ethereal SMTP login.</p><label>Sender Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Display Name<input value={displayName} onChange={e => setDisplayName(e.target.value)} /></label><label>SMTP Host<input value={smtpHost} onChange={e => setSmtpHost(e.target.value)} required /></label><label>SMTP Port<input type="number" min="1" max="65535" value={smtpPort} onChange={e => setSmtpPort(Number(e.target.value))} required /></label><label>SMTP Username<input value={smtpUser} onChange={e => setSmtpUser(e.target.value)} required /></label><label>SMTP Password<input type="password" value={smtpPassword} onChange={e => setSmtpPassword(e.target.value)} required /></label>{error && <p className="error">{error}</p>}<button className="primary full" type="submit">Save sender</button></form></div>;
}
function Compose({ senders, onClose, onDone }: { senders: Sender[]; onClose: () => void; onDone: () => void }) {
	const [fileName, setFileName] = useState('');
	const [recipients, setRecipients] = useState<string[]>([]);
	const [subject, setSubject] = useState('');
	const [body, setBody] = useState('');
	const [senderId, setSenderId] = useState(senders[0]?.id ?? '');
	const [availableSenders, setAvailableSenders] = useState(senders);
	const [senderForm, setSenderForm] = useState(false);
	const [startTime, setStartTime] = useState('');
	const [delay, setDelay] = useState(2000);
	const [limit, setLimit] = useState(200);
	const [error, setError] = useState('');

	const parse = (file: File) => {
		setFileName(file.name);
		Papa.parse<Record<string, string>>(file, {
			header: true,
			skipEmptyLines: true,
			complete: result => {
				const key = Object.keys(result.data[0] ?? {}).find(item => ['email', 'email_address', 'email address'].includes(item.trim().toLowerCase()));
				const values = result.data.map(row => key ? row[key]?.trim().toLowerCase() : '').filter(Boolean);
				setRecipients([...new Set(values.filter(item => validEmail.test(item)))]);
				if (!key) setError('No email column found.');
			},
		});
	};

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError('');
		const timestamp = new Date(startTime);
		const delayBetweenEmails = Number(delay);
		const hourlyLimit = Number(limit);
		if (!senderId) return setError('Choose a sender.');
		if (!subject.trim() || !body.trim()) return setError('Subject and message are required.');
		if (!recipients.length) return setError('Upload a CSV with at least one valid email address.');
		if (!startTime || Number.isNaN(timestamp.getTime())) return setError('Enter a valid future start time.');
		if (!Number.isInteger(delayBetweenEmails) || delayBetweenEmails < 2000) return setError('Delay must be at least 2000 ms.');
		if (!Number.isInteger(hourlyLimit) || hourlyLimit < 1 || hourlyLimit > 2000) return setError('Hourly limit must be between 1 and 2000.');
		const payload = { subject: subject.trim(), body: body.trim(), senderId, startTime: timestamp.toISOString(), delayBetweenEmails, hourlyLimit, recipients };
		try {
			const response = await emailApi.schedule(payload);
			if (response.data?.alreadyExists) {
				setError('This campaign has already been scheduled.');
				return;
			}
			onDone();
		} catch (requestError: unknown) {
			const response = requestError as { response?: { data?: { error?: string } } };
			setError(response.response?.data?.error ?? (requestError instanceof Error ? requestError.message : 'Unable to schedule emails.'));
		}
	};

	return <>{senderForm && <SenderForm onClose={() => setSenderForm(false)} onDone={sender => { setAvailableSenders(current => [...current, sender]); setSenderId(sender.id); setSenderForm(false); }} />}<div className="overlay"><form className="compose" onSubmit={submit}><div className="compose-head"><div><p className="eyebrow">NEW CAMPAIGN</p><h3>Compose email</h3></div><button type="button" className="close" onClick={onClose}>×</button></div><div className="sender-picker"><label>Sender<select value={senderId} onChange={e => setSenderId(e.target.value)} required><option value="">Choose sender</option>{availableSenders.map(sender => <option key={sender.id} value={sender.id}>{sender.displayName ? `${sender.displayName} <${sender.email}>` : sender.email}</option>)}</select></label><button type="button" className="secondary" onClick={() => setSenderForm(true)}>Add Sender</button></div><label>Subject<input value={subject} onChange={e => setSubject(e.target.value)} required /></label><label>Message<textarea rows={5} value={body} onChange={e => setBody(e.target.value)} required /></label><label className="upload"><Upload size={18}/><span>{fileName || 'Upload CSV of leads'}</span><input type="file" accept=".csv,.txt" onChange={e => e.target.files?.[0] && parse(e.target.files[0])} required /></label>{recipients.length > 0 && <div className="lead-count">{recipients.length} valid unique recipients loaded.</div>}<div className="form-grid"><label>Start time<input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} required /></label><label>Delay (ms)<input type="number" min="2000" value={delay} onChange={e => setDelay(Number(e.target.value))} /></label><label>Hourly limit<input type="number" min="1" max="2000" value={limit} onChange={e => setLimit(Number(e.target.value))} /></label></div>{error && <p className="error">{error}</p>}<button className="primary full" type="submit"><Send size={16}/> Schedule campaign</button></form></div></>;
}
createRoot(document.getElementById('root')!).render(<App />);
