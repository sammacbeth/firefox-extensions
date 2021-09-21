
function runConsent() {
    const manageButton = document.querySelector('button[title="Manage my cookies"')
    const rejectButton = document.querySelector('button[title="Reject all"]');
    if (manageButton !== null) {
        manageButton.click()
        return true;
    } else if (rejectButton !== null) {
        rejectButton.click()
        return true;
    }
    return false;
}

const checkInterval = setInterval(() => {
    if (runConsent()) {
        clearInterval(checkInterval)
    }
}, 50)