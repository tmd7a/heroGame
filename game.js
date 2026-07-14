const API_URL = "https://script.google.com/macros/s/AKfycbz6vCg6M83zEaMLKjc-SeRzLtHbrGXfwcugtP5pnM5QgYb5U_9GBv1rBM81oB5HKO0M_Q/exec";
const categories1 = ["Domme", "Influencer/Brat", "Adult Star", "Celebrity", "Captions"];
const categories2 = ["Blonde", "Red", "Brunette"];

let lastRoundScore = 0;
let activeBonusValue = 0; 
let isRolling = false;
let userRole = "hero"; 

// Check URL variables immediately to enforce user roles
function checkPlayerRole() {
    const urlParams = new URLSearchParams(window.location.search);
    const roleParam = urlParams.get('role');
    
    if (roleParam === 'villainess') {
        userRole = "villainess";
        
        const indicator = document.getElementById('roleIndicator');
        indicator.innerText = "Role: Villainess (Player 2)";
        indicator.className = "role-banner villain-role";

        // Hide Hero elements
        document.querySelectorAll('.hero-control').forEach(element => {
            element.style.display = 'none';
        });
    } else {
        userRole = "hero";
        document.getElementById('roleIndicator').innerText = "Role: Hero (Player 1)";
        // Hide Villainess setup elements from Hero view completely
        document.getElementById('villainSetup').style.display = 'none';
    }
}

// Rebuild and update elements with sheet calculations
function updateUI(data) {
    const remHp = parseInt(data.remainingHp);
    const startHp = parseInt(data.startingHp);
    const maxRounds = parseInt(data.maxRounds) || 15; 
    const currentCurse = parseInt(data.curseAmount) || 0;

    document.getElementById('startHp').innerText = startHp;
    document.getElementById('remHp').innerText = remHp;
    document.getElementById('spin1Val').innerText = data.spinner1 || "None";
    document.getElementById('spin2Val').innerText = data.spinner2 || "None";
    
    // NEW: Update Global Win/Loss Counters
    document.getElementById('heroWinCount').innerText = data.heroWins || 0;
    document.getElementById('villainWinCount').innerText = data.villainessWins || 0;
    
    // NEW: Update Running Streak Tracking Element Context
    const streakCard = document.getElementById('streakCard');
    const streakDisplay = document.getElementById('streakDisplay');
    const streakWinner = data.currentStreakWinner || "None";
    const streakCount = data.currentStreakCount || 0;

    if (streakWinner === "Villainess" && streakCount > 0) {
        streakDisplay.innerText = `Villainess 🔥 ${streakCount} Wins (+${streakCount * 5} HP Catchup Active)`;
        streakCard.style.borderColor = "#ff4757";
    } else if (streakWinner === "Hero" && streakCount > 0) {
        streakDisplay.innerText = `Hero 🌟 ${streakCount} Wins`;
        streakCard.style.borderColor = "#1e90ff";
    } else {
        streakDisplay.innerText = "No Active Streak";
        streakCard.style.borderColor = "#444";
    }

    // NEW: Build the Descending History Log Elements Dynamically
    let tableHtml = "";
    if (data.rawHistory && data.rawHistory.length > 0) {
        data.rawHistory.forEach(item => {
            let winClass = item.winner === "Hero" ? "history-winner-hero" : "history-winner-villain";
            
            // Clean up Sheets generic datetime string formats for visibility
            let displayDate = String(item.date).split('T')[0] || item.date;

            tableHtml += `
                <tr>
                    <td>${displayDate}</td>
                    <td class="${winClass}">${item.winner}</td>
                    <td>${item.cat1}</td>
                    <td>${item.cat2}</td>
                    <td>${item.startHp}</td>
                    <td>${item.finalHp}</td>
                    <td>${item.rounds}</td>
                    <td>+${item.curse}</td>
                </tr>
            `;
        });
    } else {
        tableHtml = `<tr><td colspan="8" style="text-align:center; color:#999;">No logged matches found. Finish a match to generate records!</td></tr>`;
    }
    document.getElementById('historyTableBody').innerHTML = tableHtml;
    
    
    // NEW: Update Curse Value UI Counter
    document.getElementById('curseValue').innerText = currentCurse;

    // NEW: Toggle Curse Input Lock Status for Villainess
    if (userRole === "villainess") {
        const setupBox = document.getElementById('villainSetup');
        if (currentCurse > 0) {
            setupBox.style.display = 'none'; // Lock out / hide once set
        } else {
            setupBox.style.display = 'inline-flex'; // Open if blank/unassigned
        }
    }

    let gridHtml = "";
    let finalActiveScore = 0;
    let nextEmptyFound = false;
    let filledCount = 0;

    // Generate structural dynamic cells
    for (let i = 0; i < maxRounds; i++) {
        let dmg = data.scores[i];
        let cellClass = "round-cell";
        let displayDmg = "-";

        if (dmg !== undefined && dmg !== "" && dmg !== null) {
            let parsedDmg = parseInt(dmg);
            if (!isNaN(parsedDmg) && parsedDmg >= 0 && data.scores[i] !== "") {
                cellClass += " filled";
                displayDmg = parsedDmg;
                finalActiveScore = parsedDmg; 
                filledCount++;
            } else if (!nextEmptyFound) {
                cellClass += " active";
                nextEmptyFound = true;
            }
        } else if (!nextEmptyFound) {
            cellClass += " active";
            nextEmptyFound = true;
        }

        gridHtml += `
            <div class="${cellClass}">
                <div class="round-num">Rnd ${i + 1}</div>
                <div class="round-dmg">${displayDmg}</div>
            </div>
        `;
    }
    document.getElementById('roundGrid').innerHTML = gridHtml;

    // Control Bonus Dice Box Visibility
    if (finalActiveScore === 10 && userRole === "hero") {
        document.getElementById('bonusBox').style.display = 'flex';
    } else {
        document.getElementById('bonusBox').style.display = 'none';
        document.getElementById('diceElement').innerText = "?";
        activeBonusValue = 0;
    }

    // Process Endgame Condition States
    const overlay = document.getElementById('gameOverOverlay');
    const goBox = document.getElementById('gameOverBox');
    const goTitle = document.getElementById('gameOverTitle');
    const goMsg = document.getElementById('gameOverMsg');

    if (remHp <= 0) {
        overlay.style.display = 'flex';
        if (userRole === "hero") {
            goBox.className = "game-over-box loss-theme";
            goTitle.innerText = "Defeat!";
            goMsg.innerText = "Your HP fell to 0. The Villainess wins the match!";
        } else {
            goBox.className = "game-over-box win-theme";
            goTitle.innerText = "Victory!";
            goMsg.innerText = "The Hero's HP has been completely reduced to 0. You break his resolve and win!";
        }
    } 
    else if (filledCount >= maxRounds && remHp > 0) {
        overlay.style.display = 'flex';
        if (userRole === "hero") {
            goBox.className = "game-over-box win-theme";
            goTitle.innerText = "Victory!";
            goMsg.innerText = `You successfully endured all ${maxRounds} rounds with ${remHp} HP remaining. You win!`;
        } else {
            goBox.className = "game-over-box loss-theme";
            goTitle.innerText = "Defeat!";
            goMsg.innerText = `The Hero successfully survived all ${maxRounds} rounds of attacks. You lose.`;
        }
    } 
    else {
        overlay.style.display = 'none';
    }
}

// Simulates dynamic D6 rolling sequence
function rollBonusDice() {
    if (isRolling) return;
    isRolling = true;
    
    const dice = document.getElementById('diceElement');
    dice.classList.add('rolling');
    
    let intervals = setInterval(() => {
        dice.innerText = Math.floor(Math.random() * 6) + 1;
    }, 60);

    setTimeout(() => {
        clearInterval(intervals);
        dice.classList.remove('rolling');
        
        activeBonusValue = Math.floor(Math.random() * 6) + 1;
        dice.innerText = activeBonusValue;
        isRolling = false;
    }, 500);
}

// API Call: Fetch baseline state
async function fetchGameState() {
    try {
        let response = await fetch(API_URL);
        let data = await response.json();
        updateUI(data);
    } catch (err) { console.error("Error fetching state:", err); }
}

// API Call: Spin category wheels
async function spinWheels() {
    let pick1 = categories1[Math.floor(Math.random() * categories1.length)];
    let pick2 = categories2[Math.floor(Math.random() * categories2.length)];
    
    document.getElementById('spin1Val').innerText = "Spinning...";
    document.getElementById('spin2Val').innerText = "Spinning...";

    let response = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "updateSpinners", spinner1: pick1, spinner2: pick2 })
    });
    let data = await response.json();
    updateUI(data);
}

// API Call: Submit attack parameters
async function submitScore() {
    if (isRolling) return alert("Wait for the dice to finish rolling!");
    
    let baseScore = parseInt(document.getElementById('scoreInput').value);
    if (isNaN(baseScore) || baseScore <= 0) return alert("Enter a valid damage number");

    let finalScoreToSend = baseScore + activeBonusValue;
    document.getElementById('scoreInput').value = ""; 

    let response = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "submitScore", score: finalScoreToSend })
    });
    let data = await response.json();
    updateUI(data);
}

// API Call: Reset spreadsheet
async function confirmReset() {
    let verify = confirm("Are you sure you want to completely reset the game? This will wipe out all categories and round data.");
    if (!verify) return;

    let response = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "resetGame" })
    });
    let data = await response.json();
    updateUI(data);
}

// API Call: Villainess uploads curse modifier
async function submitCurse() {
    if (userRole !== "villainess") return;
    
    let curseVal = parseInt(document.getElementById('curseInput').value);
    if (isNaN(curseVal) || curseVal <= 0) return alert("Enter a valid curse modifier value above 0!");

    let response = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "setCurse", curse: curseVal })
    });
    let data = await response.json();
    updateUI(data);
}

// Simulates Villainess dynamic D20 rolling sequence
function rollCurseDice() {
    if (isRolling || userRole !== "villainess") return;
    isRolling = true;
    
    const vDice = document.getElementById('vDiceElement');
    vDice.classList.add('rolling');
    
    // Cycle random D20 numbers rapidly during animation
    let intervals = setInterval(() => {
        vDice.innerText = Math.floor(Math.random() * 20) + 1;
    }, 60);

    setTimeout(async () => {
        clearInterval(intervals);
        vDice.classList.remove('rolling');
        
        // Calculate final D20 score outcome
        let rolledCurse = Math.floor(Math.random() * 20) + 1;
        vDice.innerText = rolledCurse;
        isRolling = false;
        
        // Automatically commit the result immediately to Google Sheets
        try {
            let response = await fetch(API_URL, {
                method: "POST",
                body: JSON.stringify({ action: "setCurse", curse: rolledCurse })
            });
            let data = await response.json();
            updateUI(data);
        } catch (err) {
            console.error("Error setting curse value:", err);
            alert("Network connection error saving curse. Try rolling again.");
            vDice.innerText = "d20";
        }
    }, 600);
}

// Controls Modal view display bounds toggles
function toggleHistoryModal(show) {
    const modal = document.getElementById('historyModal');
    modal.style.display = show ? 'flex' : 'none';
}

// Execute core cycles
checkPlayerRole();
setInterval(fetchGameState, 2000);
fetchGameState();
