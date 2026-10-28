const sentimentMessages={
  negative:"51 requests were marked concerned. The most common words were “unsafe,” “noise,” and “blocked.” These requests may need a faster response.",
  neutral:"48 requests were marked neutral. Most were questions about city services, meeting information, or requests for an update.",
  positive:"27 requests were marked positive. Residents most often thanked the board for park improvements, cleaner streets, and helpful staff responses."
};
const detail=document.querySelector("#sentiment-detail");
function setSentiment(type){detail.textContent=sentimentMessages[type];document.querySelectorAll(".sentiment-card").forEach(card=>card.classList.toggle("active",card.dataset.sentiment===type))}
setSentiment("negative");
document.querySelectorAll(".sentiment-card").forEach(card=>card.addEventListener("click",()=>setSentiment(card.dataset.sentiment)));

const methodDialog=document.querySelector("#method-dialog");
const closeMethod=()=>methodDialog.hidden=true;
document.querySelector("#method-button").addEventListener("click",()=>{methodDialog.hidden=false;document.querySelector(".close-button").focus()});
document.querySelector(".close-button").addEventListener("click",closeMethod);
document.querySelector(".close-method").addEventListener("click",closeMethod);
methodDialog.addEventListener("click",event=>{if(event.target===methodDialog)closeMethod()});
document.addEventListener("keydown",event=>{if(event.key==="Escape")closeMethod()});

function toast(message){const el=document.querySelector("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
document.querySelector("#agenda-button").addEventListener("click",()=>toast("Added to the Transportation Committee agenda"));
document.querySelector("#dismiss-button").addEventListener("click",()=>toast("Suggestion dismissed"));
document.querySelector("#all-evidence").addEventListener("click",()=>toast("Showing all related requests is coming next"));
document.querySelector("#learn-more").addEventListener("click",event=>{event.preventDefault();methodDialog.hidden=false});
const menuButton=document.querySelector(".menu-button"),sidebar=document.querySelector(".sidebar");
menuButton.addEventListener("click",()=>{const open=sidebar.classList.toggle("open");menuButton.setAttribute("aria-expanded",String(open))});
