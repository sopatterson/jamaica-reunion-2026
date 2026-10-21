(() => {
    'use strict';

    const endpoint = 'https://script.google.com/macros/s/AKfycbyP_WliVMHQDVhYX1HX7oHkEYcRZcQKt3pfebS6VG9-x7dibMN4OVw1cfw6XLqSRPeA/exec';
    const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    const form = document.getElementById('tshirtForm');
    const fields = document.getElementById('orderFields');
    const countInput = document.getElementById('memberCount');
    const sections = document.getElementById('memberSections');
    const detailsPanel = document.getElementById('detailsPanel');
    const reviewPanel = document.getElementById('reviewPanel');
    const verifySizes = document.getElementById('verifySizes');
    const confirmation = document.getElementById('confirmation');
    const status = document.getElementById('formStatus');
    const retryLoad = document.getElementById('retryLoad');
    let config;
    let credentials;
    let pendingOrder;
    let savedOrder;
    let busy = false;
    let deadlineTimer;

    for (let index = 1; index <= 10; index += 1) {
        const member = document.createElement('fieldset');
        member.className = 'member';
        member.innerHTML = `
            <legend>Family Member ${index}</legend>
            <div class="fields">
                <div>
                    <label for="memberName${index}">Family Member ${index} Name</label>
                    <input id="memberName${index}" name="memberName${index}" type="text" maxlength="100" required>
                </div>
                <div>
                    <label for="memberSize${index}">T-Shirt Size for Family Member ${index}</label>
                    <select id="memberSize${index}" name="memberSize${index}" required>
                        <option value="">Choose a size</option>
                        ${sizes.map(size => `<option value="${size}">${size}</option>`).join('')}
                    </select>
                </div>
            </div>`;
        sections.appendChild(member);
    }

    function setStatus(message, error = false) {
        status.textContent = message;
        status.classList.toggle('error', error);
    }

    function isOpen() {
        return Boolean(config?.acceptingOrders && Date.now() < Date.parse(config.deadline));
    }

    function updateAvailability() {
        clearTimeout(deadlineTimer);
        fields.disabled = busy || !isOpen();
        document.getElementById('closedNotice').hidden = !config || isOpen();
        document.getElementById('editOrder').disabled = !isOpen();
        if (isOpen()) {
            deadlineTimer = setTimeout(updateAvailability, Math.min(Date.parse(config.deadline) - Date.now(), 2147483647));
        }
    }

    function updateMemberSections() {
        [...sections.children].forEach((member, index) => {
            member.hidden = index >= Number(countInput.value);
            member.disabled = member.hidden;
        });
    }

    async function request(action, data) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(data ? endpoint : `${endpoint}?action=${action}&refresh=${Date.now()}`, {
                ...(data ? {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action, ...data })
                } : { cache: 'no-store' }),
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`The order service returned an error (${response.status}).`);
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'The order service could not complete the request.');
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('The request timed out. Check your email or retry on this page without refreshing.');
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    function renderSummary(target, order) {
        target.replaceChildren();
        const contact = document.createElement('dl');
        [
            ['Contact Name', order.contactName],
            ['Email Address', order.email],
            ['Number of Family Members', order.memberCount]
        ].forEach(([label, value]) => {
            const term = document.createElement('dt');
            term.textContent = label;
            const description = document.createElement('dd');
            description.textContent = value;
            contact.append(term, description);
        });
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrap';
        const table = document.createElement('table');
        table.innerHTML = '<thead><tr><th scope="col">Family Member Name</th><th scope="col">T-Shirt Size</th></tr></thead>';
        const body = document.createElement('tbody');
        order.members.forEach(member => {
            const row = document.createElement('tr');
            [member.name, member.size].forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            body.appendChild(row);
        });
        table.appendChild(body);
        wrapper.appendChild(table);
        target.append(contact, wrapper);
    }

    function showReview() {
        if (!isOpen()) {
            updateAvailability();
            setStatus('The order deadline has passed. New orders and edits are closed.', true);
            return;
        }
        if (!form.reportValidity()) return;
        const contactName = document.getElementById('contactName').value.trim();
        const members = Array.from({ length: Number(countInput.value) }, (_, index) => ({
            name: document.getElementById(`memberName${index + 1}`).value.trim(),
            size: document.getElementById(`memberSize${index + 1}`).value
        }));
        if (!contactName || members.some(member => !member.name)) {
            setStatus('Enter a name, not just spaces, for the contact and every family member.', true);
            return;
        }
        pendingOrder = {
            contactName,
            email: document.getElementById('email').value.trim(),
            memberCount: Number(countInput.value),
            members
        };
        renderSummary(document.getElementById('reviewSummary'), pendingOrder);
        verifySizes.checked = false;
        verifySizes.required = true;
        detailsPanel.hidden = true;
        reviewPanel.hidden = false;
        setStatus('');
        document.getElementById('reviewHeading').focus();
    }

    function showDetails(order) {
        if (order) {
            document.getElementById('contactName').value = order.contactName;
            document.getElementById('email').value = order.email;
            countInput.value = String(order.memberCount);
            order.members.forEach((member, index) => {
                document.getElementById(`memberName${index + 1}`).value = member.name;
                document.getElementById(`memberSize${index + 1}`).value = member.size;
            });
        }
        pendingOrder = null;
        verifySizes.required = false;
        reviewPanel.hidden = true;
        detailsPanel.hidden = false;
        confirmation.hidden = true;
        form.hidden = false;
        updateMemberSections();
        updateAvailability();
    }

    function privateLink() {
        const url = new URL(location.href);
        url.search = '';
        url.hash = new URLSearchParams({ order: credentials.id, token: credentials.editToken }).toString();
        return url.href;
    }

    async function initialize() {
        retryLoad.hidden = true;
        fields.disabled = true;
        setStatus('Connecting to the order form...');
        try {
            const result = await request('tshirtConfig');
            if (!Number.isFinite(Date.parse(result.deadline)) || typeof result.acceptingOrders !== 'boolean' || !result.timeZone) {
                throw new Error('The order service needs updating. Please contact the reunion organizer.');
            }
            const deadline = document.getElementById('orderDeadline');
            deadline.dateTime = result.deadline;
            deadline.textContent = new Intl.DateTimeFormat('en-US', {
                timeZone: result.timeZone, weekday: 'long', year: 'numeric', month: 'long',
                day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
            }).format(new Date(Date.parse(result.deadline) - 60000));
            const fragment = new URLSearchParams(location.hash.slice(1));
            let order;
            if (fragment.has('order') || fragment.has('token')) {
                credentials = { id: fragment.get('order'), editToken: fragment.get('token') };
                const response = await request('getTshirtOrder', { orderId: credentials.id, editToken: credentials.editToken });
                order = response.order;
                savedOrder = order;
            }
            config = result;
            showDetails(order);
            setStatus(order
                ? isOpen()
                    ? 'Your saved response is loaded. Update it below before the deadline.'
                    : 'Your saved response is loaded for viewing. Orders and edits are closed.'
                : '');
        } catch (error) {
            config = null;
            updateAvailability();
            retryLoad.hidden = false;
            setStatus(`The form could not be loaded: ${error.message}`, true);
        }
    }

    countInput.addEventListener('change', updateMemberSections);
    document.getElementById('reviewOrder').addEventListener('click', showReview);
    document.getElementById('backToDetails').addEventListener('click', () => {
        showDetails();
        document.getElementById('contactName').focus();
    });
    document.getElementById('editOrder').addEventListener('click', () => {
        showDetails(savedOrder);
        setStatus('Editing your existing family order. Review and submit to save your changes.');
        document.getElementById('contactName').focus();
    });
    retryLoad.addEventListener('click', initialize);

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        if (!pendingOrder) {
            showReview();
            return;
        }
        if (!form.reportValidity()) return;
        if (!isOpen()) {
            updateAvailability();
            setStatus('The order deadline has passed. New orders and edits are closed.', true);
            return;
        }
        busy = true;
        updateAvailability();
        setStatus('Saving your family order and sending your confirmation email...');
        try {
            if (!credentials) {
                credentials = {
                    id: crypto.randomUUID(),
                    editToken: [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('')
                };
            }
            const result = await request('saveTshirtOrder', { order: { ...pendingOrder, ...credentials } });
            savedOrder = result.order;
            history.replaceState(null, '', privateLink());
            renderSummary(document.getElementById('savedSummary'), savedOrder);
            document.getElementById('privateEditLink').value = privateLink();
            const emailStatus = document.getElementById('emailStatus');
            emailStatus.textContent = result.emailSent
                ? `A confirmation email with your response copy and private edit link was sent to ${savedOrder.email}. Check your spam folder if needed.`
                : result.warning;
            emailStatus.classList.toggle('error', !result.emailSent);
            document.getElementById('retryEmail').hidden = result.emailSent;
            form.hidden = true;
            confirmation.hidden = false;
            setStatus('');
            document.getElementById('confirmationHeading').focus();
        } catch (error) {
            setStatus(`Could not confirm your order: ${error.message} Your entries are still here. Retry on this page to avoid a duplicate order.`, true);
        } finally {
            busy = false;
            updateAvailability();
        }
    });

    document.getElementById('retryEmail').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        setStatus('Retrying your confirmation email...');
        try {
            await request('resendTshirtConfirmation', { orderId: credentials.id, editToken: credentials.editToken });
            const emailStatus = document.getElementById('emailStatus');
            emailStatus.textContent = `Confirmation email sent to ${savedOrder.email}. Check your spam folder if needed.`;
            emailStatus.classList.remove('error');
            button.hidden = true;
            setStatus('');
        } catch (error) {
            setStatus(`Your order is still saved, but the email could not be sent: ${error.message}`, true);
        } finally {
            button.disabled = false;
        }
    });

    updateMemberSections();
    initialize();
})();
