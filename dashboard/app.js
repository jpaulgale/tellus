const requests = [
  {title:"Cars speeding near P.S. 41 on West 11th Street",summary:"A parent is asking for safer crossings during school arrival and dismissal.",details:"Cars regularly speed through the intersection during school hours. The resident suggested a crossing guard, clearer signs, or a speed camera.",area:"Greenwich Village",topic:"Street safety",time:"4 days ago",urgent:true},
  {title:"Late-night noise from outdoor dining on MacDougal Street",summary:"Three nearby residents reported noise after permitted hours.",details:"Residents on the block report loud outdoor service after 11 PM on several weeknights and would like the board to review the establishment's permitted hours.",area:"Greenwich Village",topic:"Outdoor dining",time:"2 days ago",urgent:false},
  {title:"Trash piling up at Spring and Thompson Streets",summary:"A resident says bags have blocked part of the sidewalk twice this month.",details:"Trash bags from several buildings have repeatedly covered part of the sidewalk and made it difficult for wheelchairs and strollers to pass.",area:"SoHo",topic:"Trash collection",time:"Yesterday",urgent:false},
  {title:"Request for a bench near the senior center",summary:"A senior resident is asking for seating on the walk to Washington Square Park.",details:"The walk between the senior center and the park has no public seating. The resident would like the Parks Committee to consider a bench near the corner.",area:"NoHo",topic:"Public space",time:"3 hours ago",urgent:false}
];

const requestList=document.querySelector("#request-list");
requestList.innerHTML=requests.map((request,index)=>`<button class="request ${request.urgent?"urgent":""}" data-request="${index}"><span class="request-status" aria-hidden="true"></span><span><strong>${request.title}</strong><p>${request.summary}</p><span class="tag">${request.topic}</span></span><time>${request.time}</time></button>`).join("");

const dialog=document.querySelector("#dialog");
const dialogTitle=document.querySelector("#dialog-title");
const dialogBody=document.querySelector("#dialog-body");

function showToast(message){const toast=document.querySelector("#toast");toast.textContent=message;toast.classList.add("show");window.setTimeout(()=>toast.classList.remove("show"),2400)}
function closeDialog(){dialog.hidden=true}

requestList.addEventListener("click",event=>{const button=event.target.closest(".request");if(!button)return;const request=requests[Number(button.dataset.request)];dialogTitle.textContent=request.title;dialogBody.innerHTML=`<p>${request.details}</p><p><strong>Neighborhood:</strong> ${request.area}</p><p><strong>Received:</strong> ${request.time}</p>`;dialog.hidden=false;document.querySelector(".close-button").focus()});
document.querySelector(".close-button").addEventListener("click",closeDialog);
dialog.addEventListener("click",event=>{if(event.target===dialog)closeDialog()});
document.addEventListener("keydown",event=>{if(event.key==="Escape")closeDialog()});
document.querySelector(".save-button").addEventListener("click",()=>{closeDialog();showToast("Next step saved")});
document.querySelector("#add-agenda").addEventListener("click",()=>showToast("New agenda item started"));
document.querySelector(".meeting-actions button").addEventListener("click",()=>showToast("Agenda opened"));
const menuButton=document.querySelector(".menu-button");
const sidebar=document.querySelector(".sidebar");
menuButton.addEventListener("click",()=>{const isOpen=sidebar.classList.toggle("open");menuButton.setAttribute("aria-expanded",String(isOpen))});
document.querySelectorAll(".nav-link").forEach(link=>link.addEventListener("click",()=>{document.querySelector(".nav-link.active")?.classList.remove("active");link.classList.add("active");sidebar.classList.remove("open");menuButton.setAttribute("aria-expanded","false")}));
