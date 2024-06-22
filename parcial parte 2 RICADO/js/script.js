document.addEventListener("DOMContentLoaded",()=>{

    const scrollPosicion=0
    const cabecera=document.querySelector(".cabecera")
    const cabecera2=document.querySelector(".cabecera__two")
    
    
    window.addEventListener("scroll",()=>{
        if(scrollPosicion==window.scrollY){
            cabecera.style.display="flex" 

            cabecera2.style.transition="opacity 400ms ease-in-out";
            cabecera2.style.opacity="0"
            setTimeout(()=>{
                cabecera2.style.height="0px"
                cabecera2.style.opacity="1"
            },500)
        }else{
            cabecera.style.display="none" 
            
            cabecera2.style.opacity="1"
            cabecera2.style.transition="height 400ms ease-in-out";
            cabecera2.style.height="100px"
        }
    })



var modal = document.getElementById("myModal");

var img = document.getElementById("thumbnail");

var span = document.querySelector(".close");

var iframe = document.getElementById("youtubeVideo");

var videoURL = "https://www.youtube.com/embed/p54SLsUZo6M";

img.onclick = function() {
    modal.style.display = "block";
    iframe.src = videoURL + "?autoplay=1"; 
}

span.onclick = function() {
    modal.style.display = "none";   
    iframe.src=""; 
}

window.onclick = function(event) {  
    if (event.target == modal) {
        modal.style.display = "none";
        iframe.src="";
    }
}

})