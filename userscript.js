// ==UserScript==
// @name         Poe Chat Message Selector
// @namespace    http://tampermonkey.net/
// @version      0.13
// @description  Global message selector for Poe chat with AI message filter, regex filter, export and message indicators
// @author       Rabix, Claude 3.5 Sonnet
// @copyright    MIT, Rabix(RGSS3)
// @match        *://*.poe.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const CHECKBOX_SELECTOR = 'label[class*="ChatMessage_checkbox_"]';
    const CHECKED_CLASS_PREFIX = 'checkbox_isChecked_';
    const MESSAGE_CLASS_PREFIX = 'ChatMessage_chatMessage_';
    const MESSAGE_PAIR_PREFIX = 'ChatMessagesView_messagePair_';
    const BOT_HEADER_PREFIX = 'LeftSideChatMessageHeader_';

    let selectedMessage = null;
    let aiOnlyMode = false;
    let isToggling = false;

    // 用于存储编译后的正则表达式
    let compiledRegexes = {
        include1: null,
        exclude: null,
        include2: null
    };

    function createMessageIndicator() {
        const container = document.createElement('div');
        container.style.cssText = `
            margin-bottom: 10px;
            padding: 8px;
            background-color: #4a5568;
            border-radius: 4px;
            max-height: 200px;
            overflow-y: auto;
        `;

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.cssText = `
            width: 100%;
            height: auto;
            min-height: 40px;
        `;
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        container.appendChild(svg);

        function updateIndicators() {
            const messages = Array.from(document.querySelectorAll(`[class*="${MESSAGE_CLASS_PREFIX}"]`));
            if (messages.length === 0) return;

            // 计算SVG尺寸
            const ITEM_SIZE = 16;
            const ITEM_MARGIN = 4;
            const ITEMS_PER_ROW = Math.floor((container.clientWidth - 16) / (ITEM_SIZE + ITEM_MARGIN));
            const ROWS = Math.ceil(messages.length / ITEMS_PER_ROW);

            svg.setAttribute('viewBox', `0 0 ${(ITEM_SIZE + ITEM_MARGIN) * ITEMS_PER_ROW} ${(ITEM_SIZE + ITEM_MARGIN) * ROWS}`);

            // 清除现有内容
            while (svg.firstChild) {
                svg.removeChild(svg.firstChild);
            }

            messages.forEach((msg, index) => {
                const row = Math.floor(index / ITEMS_PER_ROW);
                const col = index % ITEMS_PER_ROW;
                const x = col * (ITEM_SIZE + ITEM_MARGIN) + ITEM_SIZE/2;
                const y = row * (ITEM_SIZE + ITEM_MARGIN) + ITEM_SIZE/2;

                const isAI = isAIMessage(msg);
                const isSelected = msg.querySelector(CHECKBOX_SELECTOR)?.classList.toString().includes(CHECKED_CLASS_PREFIX);
                const isCurrentSelected = msg === selectedMessage;

                // 创建消息指示器
                let indicator;
                if (isAI) {
                    // AI消息用圆形
                    indicator = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                    indicator.setAttribute('cx', x);
                    indicator.setAttribute('cy', y);
                    indicator.setAttribute('r', ITEM_SIZE/3);
                } else {
                    // 用户消息用方形
                    indicator = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                    indicator.setAttribute('x', x - ITEM_SIZE/3);
                    indicator.setAttribute('y', y - ITEM_SIZE/3);
                    indicator.setAttribute('width', ITEM_SIZE*2/3);
                    indicator.setAttribute('height', ITEM_SIZE*2/3);
                }

                // 设置样式
                indicator.setAttribute('fill', isSelected ? '#60A5FA' : '#000000');
                indicator.style.cursor = 'pointer';

                // 当前选中的消息添加特殊标记
                if (isCurrentSelected) {
                    const highlight = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                    highlight.setAttribute('cx', x);
                    highlight.setAttribute('cy', y);
                    highlight.setAttribute('r', ITEM_SIZE/2);
                    highlight.setAttribute('fill', 'none');
                    highlight.setAttribute('stroke', '#F59E0B');
                    highlight.setAttribute('stroke-width', '2');
                    svg.appendChild(highlight);
                }

                // 添加tooltip
                const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
                const content = msg.querySelector('div[class*="Message_messageTextContainer_"]')?.textContent || '';
                title.textContent = `${isAI ? 'AI' : 'User'}: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`;
                indicator.appendChild(title);

                // 添加点击事件
                indicator.addEventListener('click', () => {
                    scrollToMessage(msg);
                });

                svg.appendChild(indicator);
            });
        }

        // 添加窗口大小变化时的更新
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(updateIndicators, 100);
        });

        return { container, updateIndicators };
    }

    function compileRegexes() {
        try {
            const include1Value = includeRegex1.input.value.trim();
            compiledRegexes.include1 = include1Value ? new RegExp(include1Value) : null;
        } catch (e) {
            compiledRegexes.include1 = null;
            console.warn('Invalid regex 1:', e);
        }

        try {
            const excludeValue = excludeRegex.input.value.trim();
            compiledRegexes.exclude = excludeValue ? new RegExp(excludeValue) : null;
        } catch (e) {
            compiledRegexes.exclude = null;
            console.warn('Invalid regex 2:', e);
        }

        try {
            const include2Value = includeRegex2.input.value.trim();
            compiledRegexes.include2 = include2Value ? new RegExp(include2Value) : null;
        } catch (e) {
            compiledRegexes.include2 = null;
            console.warn('Invalid regex 3:', e);
        }
    }

    function messageMatchesFilters(messageElement) {
        const content = messageElement.querySelector('div[class*="Message_messageTextContainer_"]')?.textContent || '';

        if (compiledRegexes.include1 && !compiledRegexes.include1.test(content)) {
            return false;
        }

        if (compiledRegexes.exclude && compiledRegexes.exclude.test(content)) {
            return false;
        }

        if (compiledRegexes.include2 && !compiledRegexes.include2.test(content)) {
            return false;
        }

        return true;
    }

    function createInput(label, placeholder) {
        const container = document.createElement('div');
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 8px;
        `;

        const labelElement = document.createElement('label');
        labelElement.textContent = label;
        labelElement.style.fontSize = '12px';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.style.cssText = `
            padding: 4px 8px;
            border-radius: 4px;
            border: none;
            background-color: #2d3748;
            color: white;
            font-size: 12px;
            width: 100%;
        `;

        container.appendChild(labelElement);
        container.appendChild(input);
        return { container, input };
    }

    function checkSelectionStatus() {
        const allMessages = Array.from(document.querySelectorAll(`[class*="${MESSAGE_CLASS_PREFIX}"]`))
            .filter(msg => (!aiOnlyMode || isAIMessage(msg)) && messageMatchesFilters(msg));

        if (allMessages.length === 0) return '无可选消息';

        const checkedMessages = allMessages.filter(msg => {
            const checkbox = msg.querySelector(CHECKBOX_SELECTOR);
            return checkbox && Array.from(checkbox.classList).some(cls =>
                cls.startsWith(CHECKED_CLASS_PREFIX)
            );
        });

        if (checkedMessages.length === 0) return '未选择任何消息';
        if (checkedMessages.length === allMessages.length) return '[全部选中]';

        if (selectedMessage) {
            const messageIndex = allMessages.indexOf(selectedMessage);
            if (messageIndex !== -1) {
                const afterMessages = allMessages.slice(messageIndex);
                const beforeMessages = allMessages.slice(0, messageIndex + 1);

                const allAfterChecked = afterMessages.every(msg => {
                    const checkbox = msg.querySelector(CHECKBOX_SELECTOR);
                    return checkbox && Array.from(checkbox.classList).some(cls =>
                        cls.startsWith(CHECKED_CLASS_PREFIX)
                    );
                });

                const allBeforeChecked = beforeMessages.every(msg => {
                    const checkbox = msg.querySelector(CHECKBOX_SELECTOR);
                    return checkbox && Array.from(checkbox.classList).some(cls =>
                        cls.startsWith(CHECKED_CLASS_PREFIX)
                    );
                });

                if (allAfterChecked && checkedMessages.length === afterMessages.length) {
                    return '[选中了当前和之后的]';
                }
                if (allBeforeChecked && checkedMessages.length === beforeMessages.length) {
                    return '[选中了当前和之前的]';
                }
            }
        }

        return `[部分选中: ${checkedMessages.length}/${allMessages.length}]`;
    }

    function updateStatus() {
        statusArea.textContent = checkSelectionStatus();
    }

    function toggleCheckbox(checkbox, forceState = null) {
        const isChecked = Array.from(checkbox.classList).some(cls => cls.startsWith(CHECKED_CLASS_PREFIX));
        if (forceState === null || forceState !== isChecked) {
            isToggling = true;
            checkbox.click();
            setTimeout(() => {
                isToggling = false;
                updateStatus();
            }, 50);
        }
    }

    function scrollToMessage(messageElement) {
        if (!messageElement) return;

        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const originalBackground = messageElement.style.backgroundColor;
        const originalTransition = messageElement.style.transition;

        messageElement.style.transition = 'background-color 0.3s ease-in-out';
        messageElement.style.backgroundColor = '#4a556833';

        setTimeout(() => {
            messageElement.style.backgroundColor = originalBackground;
            setTimeout(() => {
                messageElement.style.transition = originalTransition;
            }, 300);
        }, 300);
    }

    function isAIMessage(messageElement) {
        return !!messageElement.querySelector(`[class*="${BOT_HEADER_PREFIX}"]`);
    }

    function getMessagesToProcess(startMessage, mode) {
        const messages = [];

        const currentPair = startMessage.closest(`[class*="${MESSAGE_PAIR_PREFIX}"]`);
        if (!currentPair) return messages;

        let foundStart = false;
        currentPair.querySelectorAll(`[class*="${MESSAGE_CLASS_PREFIX}"]`).forEach(msg => {
            if (msg === startMessage) {
                foundStart = true;
            }
            if (foundStart && (!mode || isAIMessage(msg)) && messageMatchesFilters(msg)) {
                messages.push(msg);
            }
        });

        let nextPair = currentPair.nextElementSibling;
        while (nextPair) {
            if (nextPair.classList.toString().includes(MESSAGE_PAIR_PREFIX)) {
                nextPair.querySelectorAll(`[class*="${MESSAGE_CLASS_PREFIX}"]`).forEach(msg => {
                    if ((!mode || isAIMessage(msg)) && messageMatchesFilters(msg)) {
                        messages.push(msg);
                    }
                });
            }
            nextPair = nextPair.nextElementSibling;
        }

        return messages;
    }

    function exportMessages(selectedOnly = true) {
        compileRegexes();

        const titleElement = document.querySelector('[class*="ChatHeader_overflow_"][class*="ChatHeader_textOverflow_"]');
        const chatTitle = titleElement ? titleElement.textContent.trim() : 'Chat Export';

        const allMessages = document.querySelectorAll(`[class*="${MESSAGE_CLASS_PREFIX}"]`);
        let messagesToExport = Array.from(allMessages).filter(msg => {
            if (selectedOnly) {
                const checkbox = msg.querySelector(CHECKBOX_SELECTOR);
                if (!checkbox || !Array.from(checkbox.classList).some(cls =>
                    cls.startsWith(CHECKED_CLASS_PREFIX)
                )) {
                    return false;
                }
            }
            if (!(!aiOnlyMode || isAIMessage(msg))) return false;
            return messageMatchesFilters(msg);
        });

        if (messagesToExport.length === 0) {
            previewArea.textContent = selectedOnly ? '没有符合条件的选中消息' : '没有符合条件的消息';
            return;
        }

        let exportText = `${chatTitle}\n\n`;

        messagesToExport.forEach(msg => {
            const isAI = isAIMessage(msg);
            let name;

            if (isAI) {
                const botHeader = msg.querySelector('[class*="BotHeader_textContainer_"]');
                name = botNameInput.input.value.trim() ||
                       (botHeader ? botHeader.textContent.trim() : 'AI');
            } else {
                name = userNameInput.input.value.trim() || 'User';
            }

            const content = msg.querySelector('div[class*="Message_messageTextContainer_"]')?.textContent.trim() || '';
            exportText += `${name}:\n${content}\n\n`;
        });

        const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${chatTitle}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        previewArea.textContent = `已导出 ${messagesToExport.length} 条消息`;
        setTimeout(() => {
            previewArea.textContent = selectedMessage ?
                `已选择${isAIMessage(selectedMessage) ? '[AI消息]' : '[用户消息]'}: ${selectedMessage.querySelector('div[class*="Message_messageTextContainer_"]')?.textContent.slice(0, 100)}...` :
                '点击任意消息来选择起始位置';
        }, 2000);
    }

    // UI初始化
    const controlPanel = document.createElement('div');
    controlPanel.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        width: 300px;
        background-color: #2d3748;
        color: white;
        padding: 12px;
        border-radius: 8px;
        z-index: 9999;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        font-size: 14px;
        max-height: 90vh;
        overflow-y: auto;
    `;

    const previewArea = document.createElement('div');
    previewArea.style.cssText = `
        margin-bottom: 10px;
        padding: 8px;
        background-color: #4a5568;
        border-radius: 4px;
        max-height: 100px;
        overflow-y: auto;
        font-size: 12px;
    `;
    previewArea.textContent = '点击任意消息来选择起始位置';

    const statusArea = document.createElement('div');
    statusArea.style.cssText = `
        margin-bottom: 10px;
        padding: 8px;
        background-color: #4a5568;
        border-radius: 4px;
        font-size: 12px;
        text-align: center;
    `;
    statusArea.textContent = checkSelectionStatus();

    const messageIndicator = createMessageIndicator();

    const titleInputContainer = document.createElement('div');
    titleInputContainer.style.cssText = `
        margin-bottom: 10px;
        padding: 8px;
        background-color: #4a5568;
        border-radius: 4px;
        display: grid;
        gap: 8px;
    `;

    const botNameInput = createInput('AI名称（留空默认从页面获取）', '例如: Llama-7B');
    const userNameInput = createInput('用户名称（留空默认为User）', '例如: Human');
    const includeRegex1 = createInput('包含正则表达式 1（优先级最高）', '例如: .*问题.*');
    const excludeRegex = createInput('排除正则表达式', '例如: .*错误.*');
    const includeRegex2 = createInput('包含正则表达式 2（优先级最低）', '例如: .*答案.*');

    titleInputContainer.appendChild(botNameInput.container);
    titleInputContainer.appendChild(userNameInput.container);
    titleInputContainer.appendChild(includeRegex1.container);
    titleInputContainer.appendChild(excludeRegex.container);
    titleInputContainer.appendChild(includeRegex2.container);

    const filterContainer = document.createElement('div');
    filterContainer.style.cssText = `
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        padding: 4px;
        background-color: #4a5568;
        border-radius: 4px;
    `;

    const aiOnlyCheckbox = document.createElement('input');
    aiOnlyCheckbox.type = 'checkbox';
    aiOnlyCheckbox.style.marginRight = '8px';
    aiOnlyCheckbox.addEventListener('change', (e) => {
        aiOnlyMode = e.target.checked;
        updateStatus();
        messageIndicator.updateIndicators();
    });

    const aiOnlyLabel = document.createElement('label');
    aiOnlyLabel.textContent = '仅选择AI消息';
    aiOnlyLabel.style.fontSize = '12px';

    filterContainer.appendChild(aiOnlyCheckbox);
    filterContainer.appendChild(aiOnlyLabel);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
    `;

    function createButton(text) {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.style.cssText = `
            padding: 6px 12px;
            background-color: #4a5568;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s;
            font-size: 12px;
        `;
        btn.addEventListener('mouseenter', () => btn.style.backgroundColor = '#606b7d');
        btn.addEventListener('mouseleave', () => btn.style.backgroundColor = '#4a5568');
        return btn;
    }

    const selectAllBtn = createButton('全选/全不选');
    const invertSelectionBtn = createButton('反向选择');
    const toggleFromSelectedBtn = createButton('切换后续');
    const scrollToBtn = createButton('跳转到所选');
    const exportBtn = createButton('导出选中');
    const exportAllBtn = createButton('导出全部');

    selectAllBtn.addEventListener('click', () => {
        compileRegexes();
        const allMessages = document.querySelectorAll(`[class*="${MESSAGE_CLASS_PREFIX}"]`);
        const messagesToProcess = Array.from(allMessages)
            .filter(msg => (!aiOnlyMode || isAIMessage(msg)) && messageMatchesFilters(msg));

        const allChecked = messagesToProcess.every(msg => {
            const checkbox = msg.querySelector(CHECKBOX_SELECTOR);
            return checkbox && Array.from(checkbox.classList).some(cls =>
                cls.startsWith(CHECKED_CLASS_PREFIX)
            );
        });

        messagesToProcess.forEach(msg => {
            const checkbox = msg.querySelector(CHECKBOX_SELECTOR);
            if (checkbox) {
                toggleCheckbox(checkbox, !allChecked);
            }
        });
        messageIndicator.updateIndicators();
    });

    invertSelectionBtn.addEventListener('click', () => {
        compileRegexes();
        const allMessages = document.querySelectorAll(`[class*="${MESSAGE_CLASS_PREFIX}"]`);
        const messagesToProcess = Array.from(allMessages)
            .filter(msg => (!aiOnlyMode || isAIMessage(msg)) && messageMatchesFilters(msg));

        messagesToProcess.forEach(msg => {
            const checkbox = msg.querySelector(CHECKBOX_SELECTOR);
            if (checkbox) {
                toggleCheckbox(checkbox);
            }
        });
        messageIndicator.updateIndicators();
    });

    toggleFromSelectedBtn.addEventListener('click', () => {
        compileRegexes();
        if (!selectedMessage) {
            previewArea.textContent = '请先点击一条消息来选择起始位置';
            return;
        }

        const messagesToProcess = getMessagesToProcess(selectedMessage, aiOnlyMode);

        const allChecked = messagesToProcess.every(msg => {
            const checkbox = msg.querySelector(CHECKBOX_SELECTOR);
            return checkbox && Array.from(checkbox.classList).some(cls =>
                cls.startsWith(CHECKED_CLASS_PREFIX)
            );
        });

        messagesToProcess.forEach(msg => {
            const checkbox = msg.querySelector(CHECKBOX_SELECTOR);
            if (checkbox) {
                toggleCheckbox(checkbox, !allChecked);
            }
        });
        messageIndicator.updateIndicators();
    });

    scrollToBtn.addEventListener('click', () => {
        if (!selectedMessage) {
            previewArea.textContent = '请先点击一条消息来选择起始位置';
            return;
        }
        scrollToMessage(selectedMessage);
    });

    exportBtn.addEventListener('click', () => exportMessages(true));
    exportAllBtn.addEventListener('click', () => exportMessages(false));

    buttonContainer.appendChild(selectAllBtn);
    buttonContainer.appendChild(invertSelectionBtn);
    buttonContainer.appendChild(toggleFromSelectedBtn);
    buttonContainer.appendChild(exportBtn);
    buttonContainer.appendChild(exportAllBtn);
    buttonContainer.appendChild(scrollToBtn);

    controlPanel.appendChild(previewArea);
    controlPanel.appendChild(statusArea);
    controlPanel.appendChild(messageIndicator.container);
    controlPanel.appendChild(titleInputContainer);
    controlPanel.appendChild(filterContainer);
    controlPanel.appendChild(buttonContainer);
    document.body.appendChild(controlPanel);

    // 初始化消息指示器
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(messageIndicator.updateIndicators, 1000);
    });

    // 消息选择事件处理
    document.addEventListener('click', (e) => {
        if (isToggling) return;

        const messageElement = e.target.closest(`[class*="${MESSAGE_CLASS_PREFIX}"]`);
        if (messageElement) {
            selectedMessage = messageElement;

            const textContent = messageElement.querySelector('div[class*="Message_messageTextContainer_"]')?.textContent || '无文本内容';

            const isAI = isAIMessage(messageElement);
            const messageType = isAI ? '[AI消息]' : '[用户消息]';

            const preview = textContent.slice(0, 100) + (textContent.length > 100 ? '...' : '');
            previewArea.textContent = `已选择${messageType}: ${preview}`;

            previewArea.style.backgroundColor = '#606b7d';
            setTimeout(() => {
                previewArea.style.backgroundColor = '#4a5568';
            }, 200);

            compileRegexes();
            updateStatus();
            messageIndicator.updateIndicators();
        }
    });
})();
