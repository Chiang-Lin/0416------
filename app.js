/**
 * JobTracker 主要邏輯
 * 依賴 Google Identity Services (GIS) 與 fetch API 存取 Google Sheets
 */

// ==========================================
// ⚠️ 請填寫您的設定檔
// ==========================================
const CLIENT_ID = '1022723633160-01o83j054i1pemlbubvvlbf6b945lajk.apps.googleusercontent.com';
const SPREADSHEET_ID = '1w-d_gUokHU7BywE0_rOzWZuN1FHSWn4oCVyjdarqsM4';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// 第一張表與第二張表名稱
const SHEET_JOBS = '職缺紀錄'; // 第一張表名稱
const SHEET_OPTIONS = '欄位表'; // 第二張表名稱

// ==========================================
// 全域狀態
// ==========================================
let tokenClient;
let accessToken = null;
let jobsData = []; // 快取下載的職缺資料

// ==========================================
// DOM 元素綁定
// ==========================================
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const authBtn = document.getElementById('auth-btn');
const logoutBtn = document.getElementById('logout-btn');

// 表單相關
const addJobForm = document.getElementById('add-job-form');
const submitBtn = document.getElementById('submit-btn');
const jobBankSelect = document.getElementById('jobBank');
const jobLocationSelect = document.getElementById('jobLocation');
const jobCategorySelect = document.getElementById('jobCategory');
const jobSalarySelect = document.getElementById('jobSalary');
const jobStatusSelect = document.getElementById('jobStatus');

const jobListContainer = document.getElementById('job-list');
const listLoader = document.getElementById('list-loader');
const refreshBtn = document.getElementById('refresh-btn');
const statTotal = document.getElementById('stat-total');
const statApplied = document.getElementById('stat-applied');
const statRate = document.getElementById('stat-rate');

// 篩選相關
const filterKeyword = document.getElementById('filter-keyword');
const filterStatus = document.getElementById('filter-status');
const filterInterest = document.getElementById('filter-interest');
const resetFilterBtn = document.getElementById('reset-filter-btn');

// Modal 相關
const editModal = document.getElementById('edit-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const editJobForm = document.getElementById('edit-job-form');

// ==========================================
// 初始化與驗證 (Auth)
// ==========================================

window.onload = function () {
    if (!CLIENT_ID || CLIENT_ID.includes('請在此填寫')) {
        showToast('請先打開 app.js 填寫 CLIENT_ID', 'error');
        authBtn.style.display = 'inline-block';
        return;
    }

    try {
        // 初始化 Google Token Client
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (tokenResponse) => {
                if (tokenResponse && tokenResponse.access_token) {
                    accessToken = tokenResponse.access_token;
                    handleAuthSuccess();
                }
            },
        });

        authBtn.style.display = 'inline-block';
        authBtn.addEventListener('click', () => {
            tokenClient.requestAccessToken();
        });
    } catch (e) {
        console.error("GIS 初始化失敗:", e);
        showToast('Google 授權套件載入失敗', 'error');
    }
};

function handleAuthSuccess() {
    loginContainer.style.display = 'none';
    appContainer.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = '新增紀錄';

    // 開始載入資料
    initializeApp();
}

logoutBtn.addEventListener('click', () => {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => {
            console.log('Token revoked');
        });
    }
    accessToken = null;
    loginContainer.style.display = 'flex';
    appContainer.style.display = 'none';
    jobsData = [];
});

// ==========================================
// 初始化應用程式
// ==========================================
async function initializeApp() {
    showToast('正在讀取設定...', 'success');
    await fetchOptions();
    await fetchJobs();
}

// 共通的 Fetch API 呼叫函式
async function gapiFetch(url, options = {}) {
    if (!accessToken) throw new Error('尚未登入');

    const defaultHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
    };

    const response = await fetch(url, {
        ...options,
        headers: { ...defaultHeaders, ...(options.headers || {}) }
    });

    let result;
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
        result = await response.json();
    } else {
        result = await response.text();
    }

    if (!response.ok) {
        console.error("API Error Response:", result);
        throw new Error(result.error?.message || 'API 請求失敗');
    }

    return result;
}

// ==========================================
// API: 讀取選項 (載入第二張工作表)
// ==========================================
async function fetchOptions() {
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_OPTIONS}!A2:E`;
        const data = await gapiFetch(url);

        const rows = data.values || [];

        // 分清空選項
        jobLocationSelect.innerHTML = '<option value="">請選擇</option>';
        jobCategorySelect.innerHTML = '<option value="">請選擇</option>';
        jobSalarySelect.innerHTML = '<option value="">請選擇</option>';
        jobStatusSelect.innerHTML = '<option value="">請選擇</option>';
        jobBankSelect.innerHTML = '<option value="">請選擇</option>';
        document.getElementById('edit-jobStatus').innerHTML = ''; // Modal用
        filterStatus.innerHTML = '<option value="">所有狀態</option>'; // 篩選器用

        rows.forEach(row => {
            // A欄：地區
            if (row[0]) addOption(jobLocationSelect, row[0]);
            // B欄：職務分類
            if (row[1]) addOption(jobCategorySelect, row[1]);
            // C欄：薪資
            if (row[2]) addOption(jobSalarySelect, row[2]);
            // D欄：狀態
            if (row[3]) {
                addOption(jobStatusSelect, row[3]);
                addOption(document.getElementById('edit-jobStatus'), row[3]);
                addOption(filterStatus, row[3]);
            }
            // E欄：人力銀行
            if (row[4]) addOption(jobBankSelect, row[4]);
        });

    } catch (err) {
        showToast('無法讀取欄位表設定: ' + err.message, 'error');
    }
}

function addOption(selectEl, value) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    selectEl.appendChild(opt);
}

// ==========================================
// API: 讀取職缺紀錄 (載入第一張工作表)
// ==========================================
async function fetchJobs() {
    listLoader.style.display = 'block';
    jobListContainer.innerHTML = '';

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_JOBS}!A2:P`;
        const data = await gapiFetch(url);

        const rows = data.values || [];
        jobsData = rows.map((row, index) => {
            // row index mapping for updates (A2 is rowIndex 2, so array index 0 + 2 = 2)
            return {
                rowIndex: index + 2,
                id: row[0] || '',
                date: row[1] || '',
                url: row[2] || '',
                bank: row[3] || '',
                company: row[4] || '',
                location: row[5] || '',
                title: row[6] || '',
                category: row[7] || '',
                salary: row[8] || '',
                applyTime: row[9] || '',
                status: row[10] || '',
                replied: row[11] || '',
                replyDate: row[12] || '',
                notes: row[13] || '',
                interest: row[14] || '',
                remark: row[15] || ''
            };
        });

        renderJobs();
        updateDashboard();

    } catch (err) {
        showToast('無法讀取職缺紀錄: ' + err.message, 'error');
    } finally {
        listLoader.style.display = 'none';
    }
}

refreshBtn.addEventListener('click', fetchJobs);

// ==========================================
// API: 新增職缺紀錄 (Append)
// ==========================================
addJobForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = '新增中...';

    // 準備資料
    const newId = new Date().getTime().toString();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const rowData = [
        newId,
        today,
        document.getElementById('jobUrl').value,
        document.getElementById('jobBank').value,
        document.getElementById('jobCompany').value,
        document.getElementById('jobLocation').value,
        document.getElementById('jobTitle').value,
        document.getElementById('jobCategory').value,
        document.getElementById('jobSalary').value,
        '', // 投遞時間留空 (J)
        document.getElementById('jobStatus').value, // (K)
        '否', // 預設未回覆 (L)
        '', // 回覆日期留空 (M)
        '', // 面試紀錄留空 (N)
        document.getElementById('jobInterest').value, // 興趣程度 (O)
        document.getElementById('jobRemark').value  // 備註 (P)
    ];

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_JOBS}!A:P:append?valueInputOption=USER_ENTERED`;
        await gapiFetch(url, {
            method: 'POST',
            body: JSON.stringify({ values: [rowData] })
        });

        showToast('成功新增一筆職缺！', 'success');
        addJobForm.reset();
        await fetchJobs(); // 重新讀取

    } catch (err) {
        showToast('新增失敗: ' + err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '新增紀錄';
    }
});

// ==========================================
// API: 更新職缺紀錄 (Update row)
// ==========================================
// 快速更新狀態
async function quickUpdateStatus(rowIndex, newStatus) {
    // 狀態在 K 欄
    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_JOBS}!K${rowIndex}?valueInputOption=USER_ENTERED`;
        await gapiFetch(url, {
            method: 'PUT',
            body: JSON.stringify({ values: [[newStatus]] })
        });
        showToast('狀態更新成功', 'success');

        // 更新本地端資料與畫面以加速體驗
        const target = jobsData.find(j => j.rowIndex === rowIndex);
        if (target) target.status = newStatus;
        updateDashboard();

    } catch (err) {
        showToast('更新失敗: ' + err.message, 'error');
        fetchJobs(); // 恢復正確狀態
    }
}

// 透過 Modal 更新進階資料
editJobForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('save-edit-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存中...';

    const id = document.getElementById('edit-id').value;
    const target = jobsData.find(j => j.id === id);
    if (!target) return;

    // 取得表單中的資料
    const status = document.getElementById('edit-jobStatus').value;
    const applyTime = document.getElementById('edit-applyTime').value.replace('T', ' '); // 將 T 換成空白比較好看
    const replied = document.querySelector('input[name="replied"]:checked')?.value || '否';
    const replyDate = document.getElementById('edit-replyDate').value;
    const notes = document.getElementById('edit-notes').value;
    const interest = document.getElementById('edit-jobInterest').value;
    const remark = document.getElementById('edit-jobRemark').value;

    try {
        // 在我們的架構中，ApplyTime 到 Remark 是從 J 到 P 欄
        // J=ApplyTime, K=Status, L=Replied, M=ReplyDate, N=Notes, O=Interest, P=Remark
        const range = `${SHEET_JOBS}!J${target.rowIndex}:P${target.rowIndex}`;
        const values = [[applyTime, status, replied, replyDate, notes, interest, remark]];

        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
        await gapiFetch(url, {
            method: 'PUT',
            body: JSON.stringify({ values: values })
        });

        showToast('資料更新成功', 'success');
        closeModal();
        await fetchJobs(); // 重新讀取

    } catch (err) {
        showToast('更新失敗: ' + err.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存修改';
    }
});

// 註冊篩選事件
filterKeyword.addEventListener('input', renderJobs);
filterStatus.addEventListener('change', renderJobs);
filterInterest.addEventListener('change', renderJobs);

resetFilterBtn.addEventListener('click', () => {
    filterKeyword.value = '';
    filterStatus.value = '';
    filterInterest.value = '';
    renderJobs();
});


// ==========================================
// 篩選功能與 UI 渲染邏輯
// ==========================================
function renderJobs() {
    jobListContainer.innerHTML = '';

    // 取得篩選條件
    const keyword = filterKeyword.value.toLowerCase().trim();
    const statusFilter = filterStatus.value;
    const interestFilter = filterInterest.value;

    let filteredData = [...jobsData];

    if (keyword) {
        filteredData = filteredData.filter(job => 
            (job.title && job.title.toLowerCase().includes(keyword)) ||
            (job.company && job.company.toLowerCase().includes(keyword)) ||
            (job.remark && job.remark.toLowerCase().includes(keyword)) ||
            (job.notes && job.notes.toLowerCase().includes(keyword))
        );
    }
    
    if (statusFilter) {
        filteredData = filteredData.filter(job => job.status === statusFilter);
    }
    
    if (interestFilter) {
        filteredData = filteredData.filter(job => job.interest === interestFilter);
    }

    // 反序排列 (最新的在前面)
    const sortedData = filteredData.reverse();

    if (sortedData.length === 0) {
        jobListContainer.innerHTML = '<div class="loader">沒有符合篩選條件的紀錄。</div>';
        return;
    }

    sortedData.forEach(job => {
        const card = document.createElement('div');
        card.className = 'job-card';

        // 判斷狀態給予不同的顏色標籤
        let statusClass = '';
        if (job.status.includes('面試')) statusClass = 'status-interview';
        else if (job.status.includes('已投遞')) statusClass = 'status-applied';
        else if (job.status.includes('Offer')) statusClass = 'status-offer';
        else if (job.status.includes('感謝')) statusClass = 'status-reject';

        card.innerHTML = `
            <div class="job-header">
                <div>
                    <div class="job-company">${job.company}</div>
                    <a href="${job.url}" target="_blank" class="job-title">${job.title}</a>
                </div>
            </div>
            
            <div class="job-tags">
                ${job.bank ? `<span class="tag">#${job.bank}</span>` : ''}
                ${job.location ? `<span class="tag">#${job.location}</span>` : ''}
                ${job.category ? `<span class="tag">#${job.category}</span>` : ''}
                ${job.salary ? `<span class="tag">#${job.salary}</span>` : ''}
                ${job.status ? `<span class="tag ${statusClass}">${job.status}</span>` : ''}
                ${job.interest ? `<span class="tag" style="background:#FFF0F5; color:#C28193; border-color:#F5D0D9;">${job.interest}</span>` : ''}
            </div>

            ${job.remark ? `<div style="font-size:0.85rem; color:#6b7280; margin-bottom:8px;"><strong>備註：</strong>${job.remark}</div>` : ''}
            ${job.notes ? `<div style="font-size:0.85rem; color:#6b7280; margin-bottom:12px; font-style:italic;">面試紀錄："${job.notes}"</div>` : ''}

            <div class="job-footer">
                <div>加入日期：${job.date}</div>
                <div class="job-actions">
                    <select class="status-select-inline" data-row="${job.rowIndex}">
                        <option value="">快速停泊狀態...</option>
                        ${Array.from(jobStatusSelect.options).map(opt => {
            if (!opt.value) return '';
            return `<option value="${opt.value}" ${job.status === opt.value ? 'selected' : ''}>${opt.value}</option>`;
        }).join('')}
                    </select>
                    <button class="btn btn-outline" style="padding: 4px 8px; font-size: 0.8rem; color: #EF4444; border-color: #fca5a5;" onclick="deleteJob('${job.id}')">刪除</button>
                    <button class="btn btn-outline" style="padding: 4px 8px; font-size: 0.8rem;" onclick="openEditModal('${job.id}')">編輯</button>
                </div>
            </div>
        `;

        jobListContainer.appendChild(card);
    });

    // 綁定快速切換狀態的事件
    document.querySelectorAll('.status-select-inline').forEach(select => {
        select.addEventListener('change', (e) => {
            const rowIndex = e.target.getAttribute('data-row');
            const newStatus = e.target.value;
            if (newStatus) {
                quickUpdateStatus(rowIndex, newStatus);
            }
        });
    });
}

function updateDashboard() {
    const total = jobsData.length;
    const appliedJobs = jobsData.filter(j => j.status && (j.status.includes('投遞') || j.status.includes('面試') || j.status.includes('Offer')));
    const repliedJobs = jobsData.filter(j => j.replied === '是');

    const appliedStr = appliedJobs.length;
    let rate = 0;
    if (appliedStr > 0) {
        rate = Math.round((repliedJobs.length / appliedStr) * 100);
    }

    statTotal.textContent = total;
    statApplied.textContent = appliedStr;
    statRate.textContent = `${rate}%`;
}

// ==========================================
// API: 刪除職缺紀錄 (Delete row)
// ==========================================
window.deleteJob = async function(id) {
    if (!confirm('您確定要刪除這筆紀錄嗎？這將會從 Google 試算表中永久移除！')) return;
    
    const target = jobsData.find(j => j.id === id);
    if (!target) return;
    
    try {
        showToast('正在刪除中...', 'success');
        
        // 1. 先取得這張表 (SHEET_JOBS) 的 sheetId
        const ssInfoUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets(properties(sheetId,title))`;
        const ssInfo = await gapiFetch(ssInfoUrl);
        const sheet = ssInfo.sheets.find(s => s.properties.title === SHEET_JOBS);
        if (!sheet) throw new Error('找不到工作表 ID');
        
        const sheetId = sheet.properties.sheetId;
        
        // 2. 呼叫 batchUpdate 實體刪除該 Row
        const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`;
        await gapiFetch(batchUrl, {
            method: 'POST',
            body: JSON.stringify({
                requests: [
                    {
                        deleteDimension: {
                            range: {
                                sheetId: sheetId,
                                dimension: "ROWS",
                                startIndex: target.rowIndex - 1, // 0-based index
                                endIndex: target.rowIndex
                            }
                        }
                    }
                ]
            })
        });
        
        showToast('刪除成功！', 'success');
        await fetchJobs(); // 重新讀取，確保 rowIndex 序列正確
        
    } catch (err) {
        showToast('刪除失敗: ' + err.message, 'error');
    }
}



// ==========================================
// Modal 顯示控制
// ==========================================
window.openEditModal = function (id) {
    const job = jobsData.find(j => j.id === id);
    if (!job) return;

    // 將資料載入 Modal
    document.getElementById('edit-id').value = job.id;
    document.getElementById('edit-jobStatus').value = job.status;
    document.getElementById('edit-applyTime').value = job.applyTime.replace(' ', 'T'); // 轉回 datetime-local 格式 (若有)

    if (job.replied === '是') {
        document.querySelector('input[name="replied"][value="是"]').checked = true;
    } else {
        document.querySelector('input[name="replied"][value="否"]').checked = true;
    }

    document.getElementById('edit-replyDate').value = job.replyDate;
    document.getElementById('edit-notes').value = job.notes;
    document.getElementById('edit-jobInterest').value = job.interest || '';
    document.getElementById('edit-jobRemark').value = job.remark || '';

    editModal.style.display = 'flex';
}

function closeModal() {
    editModal.style.display = 'none';
}

closeModalBtn.addEventListener('click', closeModal);
cancelEditBtn.addEventListener('click', closeModal);


// ==========================================
// Toast 提示工具
// ==========================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = type === 'success' ? '✅' : '⚠️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
