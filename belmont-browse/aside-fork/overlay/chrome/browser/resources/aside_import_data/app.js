// Copyright 2026 At Your Side Inc.
import"/strings.m.js";import{loadTimeData}from"chrome://resources/js/load_time_data.js";import{html,render}from"chrome://resources/lit/v3_0/lit.rollup.js";const webUiListenerMap=new Map;function addWebUiListener(eventName,callback){const listeners=webUiListenerMap.get(eventName)??[];listeners.push(callback);webUiListenerMap.set(eventName,listeners)}const globalWithCr=globalThis;globalWithCr.cr={...globalWithCr.cr,webUIListenerCallback(eventName,...args){for(const listener of webUiListenerMap.get(eventName)??[]){listener(...args)}}};const BROWSER_DEFINITIONS=[{id:"chrome",iconPath:"icons/chrome.svg",label:"Chrome"},{id:"safari",iconClassName:"icon-glyph--safari",iconPath:"icons/safari.png",label:"Safari"},{id:"firefox",iconPath:"icons/firefox.svg",label:"Firefox"},{id:"edge",iconClassName:"icon-glyph--edge",iconPath:"icons/edge.svg",label:"Microsoft Edge"},{id:"arc",iconPath:"icons/arc.svg",label:"Arc"},{id:"atlas",iconPath:"icons/atlas.png",label:"ChatGPT Atlas"},{id:"comet",iconPath:"icons/comet.png",label:"Comet"},{id:"dia",iconClassName:"icon-glyph--dia",iconPath:"icons/dia.png",label:"Dia"}];const state={installedBrowsers:[],importingBrowserId:null,isSafariGuideOpen:false,isLoading:true,safariValidationErrorMessage:null,selectedBrowserId:null};function updateImportButtonState(){const importButton=document.querySelector(".import-button");if(importButton){const isEnabled=state.selectedBrowserId!==null&&state.importingBrowserId===null;importButton.disabled=!isEnabled;importButton.setAttribute("aria-disabled",isEnabled?"false":"true")}}function getBrowserListElement(){return document.querySelector(".browser-list")}function sendWebUiMessage(message,args=[]){const chromeApi=globalThis.chrome;chromeApi?.send(message,args)}function getSafariGuideHostElement(){return document.querySelector(".safari-guide-host")}function closeSafariGuide(){if(!state.isSafariGuideOpen){return}state.isSafariGuideOpen=false;state.safariValidationErrorMessage=null;renderSafariGuideModal()}function openSafariGuide(){if(state.isSafariGuideOpen){return}state.isSafariGuideOpen=true;renderSafariGuideModal()}function onSafariGuideOverlayClick(event){if(event.target!==event.currentTarget){return}closeSafariGuide()}function closeSafariValidationError(){if(!state.safariValidationErrorMessage){return}state.safariValidationErrorMessage=null;renderSafariGuideModal()}function onSafariSelectZipFileClick(){sendWebUiMessage("selectSafariExportZipFile")}function onSafariImportInvalidFile(message){state.importingBrowserId=null;state.isSafariGuideOpen=true;state.safariValidationErrorMessage=message||"This is not a valid Safari data ZIP file.";updateImportButtonState();renderBrowserList();renderSafariGuideModal()}function renderSafariGuideModal(){const modalHost=getSafariGuideHostElement();if(!modalHost){return}render(html`
        ${state.isSafariGuideOpen?html`
          <div class="safari-guide-overlay" @click="${onSafariGuideOverlayClick}">
            <section class="safari-guide-modal" aria-label="Safari import guide"
                aria-modal="true" role="dialog">
              <button class="safari-guide-close" type="button"
                  aria-label="Close Safari import guide"
                  @click="${closeSafariGuide}">
                <span aria-hidden="true">×</span>
              </button>
              <div class="safari-guide-art">
                <img src="images/safari_import_guide.png"
                    alt="Safari export guide">
              </div>
              <div class="safari-guide-copy">
                <div class="safari-guide-eyebrow">Import from Safari</div>
                <h2 class="safari-guide-title">
                  Export your Safari data first
                </h2>
                <p class="safari-guide-description">
                  In Safari, choose <strong>File &gt; Export</strong>, then open
                  the ZIP file Safari creates.
                </p>
                <div class="safari-guide-steps">
                  <div class="safari-guide-step">
                    <div class="safari-guide-step-number">1</div>
                    <div class="safari-guide-step-text">
                      Open Safari on this Mac.
                    </div>
                  </div>
                  <div class="safari-guide-step">
                    <div class="safari-guide-step-number">2</div>
                    <div class="safari-guide-step-text">
                      Choose <strong>File &gt; Export</strong>.
                    </div>
                  </div>
                  <div class="safari-guide-step">
                    <div class="safari-guide-step-number">3</div>
                    <div class="safari-guide-step-text">
                      Select the exported ZIP file below.
                    </div>
                  </div>
                </div>
                <div class="safari-guide-file-block">
                  <button class="safari-select-button" type="button"
                      @click="${onSafariSelectZipFileClick}">
                    Select Safari Data ZIP File
                  </button>
                  <div class="safari-selected-file is-visible">
                    Choose the ZIP file exported from Safari.
                  </div>
                </div>
              </div>
            </section>
          </div>`:html``}
        ${state.safariValidationErrorMessage?html`
          <div class="safari-validation-overlay">
            <section class="safari-validation-dialog" aria-label="Safari import error"
                aria-modal="true" role="alertdialog">
              <div class="safari-validation-message">
                ${state.safariValidationErrorMessage}
              </div>
              <button class="safari-validation-button" type="button"
                  @click="${closeSafariValidationError}">
                OK
              </button>
            </section>
          </div>`:html``}
      `,modalHost)}function onImportButtonClick(){if(state.importingBrowserId!==null||state.selectedBrowserId===null){return}if(state.selectedBrowserId==="safari"){openSafariGuide();return}if(state.selectedBrowserId==="firefox"){sendWebUiMessage("importFirefoxData");return}if(!["arc","atlas","chrome","comet","dia","edge"].includes(state.selectedBrowserId)){return}const importButton=document.querySelector(".import-button");if(!importButton){return}const buttonRect=importButton.getBoundingClientRect();sendWebUiMessage("showProfilePicker",[state.selectedBrowserId,buttonRect.left,buttonRect.top,buttonRect.width,buttonRect.height])}function onBrowserOptionSelected(browserId){if(state.importingBrowserId!==null){return}state.selectedBrowserId=browserId;if(browserId!=="safari"){closeSafariGuide()}else{state.safariValidationErrorMessage=null}renderBrowserList();updateImportButtonState()}function onBrowserOptionKeyDown(event,browserId){if(event.key!=="Enter"&&event.key!==" "){return}event.preventDefault();onBrowserOptionSelected(browserId)}function renderBrowserList(){const browserList=getBrowserListElement();if(!browserList){return}browserList.classList.toggle("is-loading",state.isLoading);browserList.classList.toggle("is-empty",!state.isLoading&&state.installedBrowsers.length===0);render(state.installedBrowsers.length===0?html`<div class="browser-empty-state">
            No supported browsers found on this device.
          </div>`:html`${state.installedBrowsers.map((browser=>{const isSelected=browser.id===state.selectedBrowserId;const isImporting=browser.id===state.importingBrowserId;const optionClass=["browser-option",isSelected?"is-selected":"",state.importingBrowserId!==null?"is-disabled":"",isImporting?"is-importing":""].filter(Boolean).join(" ");const iconClass=browser.iconClassName?`icon-glyph ${browser.iconClassName}`:"icon-glyph";const indicatorWrapClass=isSelected||isImporting?"check-wrap":"check-wrap is-hidden";return html`
          <div class="${optionClass}" aria-busy="${isImporting?"true":"false"}"
              aria-current="${isSelected?"true":"false"}"
              data-browser-id="${browser.id}" data-browser-option="" role="button"
              tabindex="0" @click="${()=>onBrowserOptionSelected(browser.id)}"
              @keydown="${event=>onBrowserOptionKeyDown(event,browser.id)}">
            <div class="icon-frame">
              <span class="${iconClass}">
                <img src="${browser.iconPath}" alt="">
              </span>
            </div>
            <div class="browser-label">${browser.label}</div>
            <div class="${indicatorWrapClass}">
              ${isImporting?html`<div class="loading-indicator" aria-hidden="true"></div>`:html`<img src="icons/check.svg" alt="">`}
            </div>
          </div>
        `}))}`,browserList)}function getInstalledBrowserIds(){if(!loadTimeData.valueExists("installedBrowsers")){return new Set}const installedBrowserList=JSON.parse(loadTimeData.getString("installedBrowsers"));return new Set(Array.isArray(installedBrowserList)?installedBrowserList:[])}async function initializeBrowserOptions(){if(!getBrowserListElement()){return}state.isLoading=true;state.importingBrowserId=null;state.selectedBrowserId=null;state.installedBrowsers=[];updateImportButtonState();renderBrowserList();await new Promise((resolve=>requestAnimationFrame((()=>resolve()))));let installedBrowserIds=new Set;try{installedBrowserIds=getInstalledBrowserIds()}catch{}state.installedBrowsers=BROWSER_DEFINITIONS.filter((definition=>installedBrowserIds.has(definition.id)));state.isLoading=false;updateImportButtonState();renderBrowserList();renderSafariGuideModal()}function onBrowserImportStarted(browserId,profilePath){state.importingBrowserId=browserId;if(browserId==="safari"){closeSafariGuide()}updateImportButtonState();renderBrowserList();void profilePath}function onBrowserImportSucceeded(browserId){if(state.importingBrowserId!==browserId){return}state.importingBrowserId=null;updateImportButtonState();renderBrowserList()}function onBrowserImportFailed(browserId){if(state.importingBrowserId!==browserId){return}state.importingBrowserId=null;updateImportButtonState();renderBrowserList()}function initializeImportButton(){const importButton=document.querySelector(".import-button");if(!importButton){return}importButton.addEventListener("click",onImportButtonClick)}function initializeBrowserImportListeners(){addWebUiListener("browser-import-started",onBrowserImportStarted);addWebUiListener("browser-import-succeeded",onBrowserImportSucceeded);addWebUiListener("browser-import-failed",onBrowserImportFailed);addWebUiListener("safari-import-invalid-file",onSafariImportInvalidFile)}initializeBrowserImportListeners();initializeImportButton();initializeBrowserOptions();renderSafariGuideModal();