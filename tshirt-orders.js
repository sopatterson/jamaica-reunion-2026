(() => {
    'use strict';

    const endpoint = 'https://script.google.com/macros/s/AKfycbyP_WliVMHQDVhYX1HX7oHkEYcRZcQKt3pfebS6VG9-x7dibMN4OVw1cfw6XLqSRPeA/exec';
    const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    const status = document.getElementById('managerStatus');
    const refreshButton = document.getElementById('refreshOrders');
    const downloadButton = document.getElementById('downloadOrders');
    const dataPanel = document.getElementById('orderData');
    let orders = [];
    let loading = false;
    let loaded = false;

    function setStatus(message, error = false) {
        status.textContent = message;
        status.classList.toggle('error', error);
    }

    function sizeTotals() {
        return sizes.map(size => [
            size,
            orders.reduce((total, order) => total + order.members.filter(member => member.size === size).length, 0)
        ]);
    }

    function appendRow(body, values) {
        const row = document.createElement('tr');
        values.forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });
        body.appendChild(row);
    }

    function renderOrders() {
        const sizeRows = document.getElementById('sizeRows');
        const personRows = document.getElementById('personRows');
        sizeRows.replaceChildren();
        personRows.replaceChildren();
        sizeTotals().forEach(row => appendRow(sizeRows, row));
        orders.forEach(order => order.members.forEach(member => {
            appendRow(personRows, [order.contactName, order.email, member.name, member.size]);
        }));
        const totalShirts = orders.reduce((total, order) => total + order.members.length, 0);
        document.getElementById('orderTotals').textContent = `${orders.length} family orders / ${totalShirts} shirts`;
        dataPanel.hidden = false;
    }

    function validateOrders(value) {
        if (!Array.isArray(value) || value.some(order =>
            !order || typeof order.id !== 'string' || typeof order.contactName !== 'string' ||
            typeof order.email !== 'string' || !Number.isInteger(order.memberCount) ||
            order.memberCount < 1 || order.memberCount > 10 ||
            !Array.isArray(order.members) || order.members.length !== order.memberCount ||
            order.members.some(member => !member || typeof member.name !== 'string' || !member.name.trim() || !sizes.includes(member.size))
        )) {
            throw new Error('The saved order list is incomplete. Contact the reunion organizer before downloading.');
        }
        return value;
    }

    async function loadOrders() {
        if (loading) return false;
        loading = true;
        loaded = false;
        refreshButton.disabled = true;
        downloadButton.disabled = true;
        dataPanel.hidden = true;
        orders = [];
        setStatus('Loading all current orders...');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const managerToken = new URLSearchParams(location.hash.slice(1)).get('token');
            if (!managerToken || !/^[0-9a-f]{64}$/.test(managerToken)) {
                throw new Error('Open the full private manager link emailed to the T-shirt organizer.');
            }
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'listTshirtOrders', managerToken }),
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`The order service returned an error (${response.status}).`);
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'The order list could not be loaded.');
            orders = validateOrders(result.orders);
            renderOrders();
            loaded = true;
            setStatus('All current orders are loaded. Downloads include one row per person and a shirt-size totals worksheet.');
            return true;
        } catch (error) {
            setStatus(error.name === 'AbortError'
                ? 'Loading orders timed out. Refresh orders to retry; no spreadsheet was downloaded.'
                : `Could not load orders: ${error.message}`, true);
            return false;
        } finally {
            clearTimeout(timer);
            loading = false;
            refreshButton.disabled = false;
            downloadButton.disabled = !loaded;
        }
    }

    async function downloadOrders() {
        if (!await loadOrders()) return;
        try {
            if (typeof XLSX === 'undefined') throw new Error('The Excel download tool did not load. Refresh the page and try again.');
            const rows = orders.flatMap(order => order.members.map(member => [
                order.contactName, order.email, order.memberCount, member.name, member.size, order.id
            ]));
            const orderSheet = XLSX.utils.aoa_to_sheet([
                ['Contact Name', 'Email Address', 'Family Shirt Count', 'Family Member Name', 'T-Shirt Size', 'Order Reference'],
                ...rows
            ]);
            orderSheet['!cols'] = [28, 36, 20, 28, 14, 40].map(wch => ({ wch }));
            const totalShirts = orders.reduce((total, order) => total + order.members.length, 0);
            const summarySheet = XLSX.utils.aoa_to_sheet([
                ['T-Shirt Size', 'Quantity'], ...sizeTotals(),
                ['Total Shirts', totalShirts], ['Family Orders', orders.length]
            ]);
            summarySheet['!cols'] = [{ wch: 20 }, { wch: 14 }];
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, orderSheet, 'Orders');
            XLSX.utils.book_append_sheet(workbook, summarySheet, 'Size Totals');
            XLSX.writeFile(workbook, 'jamaica-reunion-2026-tshirt-orders.xls', { bookType: 'biff8' });
            setStatus('All current orders downloaded in one Excel file, with Orders and Size Totals worksheets.');
        } catch (error) {
            setStatus(`Could not download orders: ${error.message}`, true);
        }
    }

    refreshButton.addEventListener('click', loadOrders);
    downloadButton.addEventListener('click', downloadOrders);
    window.addEventListener('hashchange', loadOrders);
    loadOrders();
})();
